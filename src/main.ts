import * as THREE from 'three';
import { Game } from './core/game';
import { Input } from './core/input';
import { Loop } from './core/loop';
import { uiText } from './data/uiText';
import type { DebugTools } from './debug';
import { buildGreybox } from './level/greybox';
import { drawBoxModels, loadLevelModels, modelledBoxes } from './level/models';
import { texturedMaterial } from './level/materials';
import { Navigation } from './level/navigation';
import { GlassSystem } from './level/glassSystem';
import { CoverPoints, levelCover } from './level/cover';
import { onFocusLost } from './platform/focus';
import { attachInputListeners } from './platform/inputListeners';
import { captureWhileHeld, createPointerLock } from './platform/pointerLock';
import { Player } from './player/player';
import { fallDamage } from './player/fall';
import { PlayerHealth } from './player/playerHealth';
import { HealItems } from './player/healItems';
import { healthConfig } from './config/health';
import { standsOnHazard } from './level/hazards';
import { createOverlay } from './ui/overlay';
import { createHud } from './ui/hud';
import { HealthScreen } from './ui/healthScreen';
import { HealthFeelState } from './player/healthFeel';
import { HealthSounds } from './audio/healthSounds';
import { MovementSounds } from './audio/movementSounds';
import { MovementReporter } from './player/movementReporter';
import { surfaceAt } from './level/surfaces';
import { EventBus } from './core/events';
import { testArenaLevel } from './data/testArena';
import { chamberLevel } from './data/chamber';
import { levelLayout, spotRad } from './level/levelData';
import { Dummy } from './enemies/dummy';
import { DummyView } from './enemies/dummyView';
import { StandInEnemy } from './enemies/standInEnemy';
import { StandInView } from './enemies/standInView';
import { describeFlankRejects, StandInWorld } from './enemies/standInWorld';
import type { Target } from './enemies/target';
import { squadConfig } from './config/squad';
import { standInConfig } from './config/standInEnemy';
import { dummyConfig } from './config/dummy';
import { keepApart } from './enemies/bodies';
import { StoreyPush } from './squad/storeyPush';
import { SquadCoordinator, type PushKind } from './squad/squadCoordinator';
import { downCaller, pushCaller, sideWord } from './squad/callouts';
import { EnemySteps } from './enemies/enemySteps';
import { EnemySounds } from './audio/enemySounds';
import type { CalloutKind } from './weapons/events';
import type { NoiseKind } from './stealth/noise';
import { BulletMarks } from './fx/bulletMarks';
import { Tracers } from './fx/tracers';
import { GlassFx } from './fx/glassFx';
import { ImpactSparks } from './fx/impactSparks';
import { Exposure, type Glimpse } from './player/exposure';
import { pistolConfig } from './config/pistol';
import { viewConfig } from './config/view';
import { grenadeConfig } from './config/grenade';
import { editorLookButton, inputConfig } from './config/input';
import { BarrelSmoke } from './fx/barrelSmoke';
import { AudioSystem } from './audio/audioSystem';
import { SoundTap } from './audio/soundTap';
import { NoiseReporter } from './stealth/noiseReporter';
import { WeaponSounds } from './audio/weaponSounds';
import { viewmodelConfig } from './config/viewmodel';
import { dummyBlastTarget, GrenadeSystem } from './weapons/grenade/grenadeSystem';
import { GrenadeThrower } from './weapons/grenade/thrower';
import { CameraShake } from './fx/cameraShake';
import { Explosions } from './fx/explosions';
import { Casings } from './fx/casings';
import { Aim } from './weapons/aim';
import { HoldTap } from './weapons/holdTap';
import type { AnimatorInput } from './weapons/viewmodel/animator';
import { rifleConfig } from './config/rifle';
import type { WeaponEvents, WeaponId } from './weapons/events';
import { Gun } from './weapons/gun';
import { Knife } from './weapons/knife';
import { KnifeStrike } from './weapons/knifeStrike';
import { Viewmodel } from './weapons/viewmodel/viewmodel';
import { Shooter } from './weapons/shooter';
import { WeaponSet } from './weapons/weaponSet';
import { Pickups } from './pickups/pickups';
import { PickupsView } from './pickups/pickupsView';

const fireButton = 0; // left mouse
const aimButton = 2; // right mouse
const weaponKeys: Record<string, WeaponId> = { Digit1: 'rifle', Digit2: 'pistol', Digit3: 'knife' };

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.autoClear = false; // the world and the weapon are drawn in two passes (see the render step)
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101418);
const camera = new THREE.PerspectiveCamera(viewConfig.baseFovDeg, window.innerWidth / window.innerHeight, 0.05, 100);

scene.add(new THREE.HemisphereLight(0xffffff, 0x333a40, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(4, 8, 3);
scene.add(sun);

// The level (5.3): the central chamber. On the dev server, `?level=test-arena` in the address loads the test arena
// (decision 236) instead, for comparing the AI between the two.
const levelData = import.meta.env.DEV && new URLSearchParams(location.search).get('level') === 'test-arena' ? testArenaLevel : chamberLevel;
const levelFloor = levelLayout(levelData);
// The boxes' models (5.5b) load before the first frame; a box whose model cannot load is drawn grey.
const levelModels = await loadLevelModels(levelData.boxes);
const level = buildGreybox(levelData.boxes, levelFloor, new Set(modelledBoxes(levelData.boxes, levelModels)), texturedMaterial);
const levelModelMeshes = drawBoxModels(levelData.boxes, levelModels);
if (levelModelMeshes.length > 0) level.group.add(...levelModelMeshes);
level.boxMeshes.push(...levelModelMeshes); // hidden with the grey boxes while the editor draws its own copy
scene.add(level.group);
// The navigation mesh (4.2): built once from the room, where enemies can walk. Takes milliseconds, before the first frame.
// A room with floor-standing glass (5.4) gets a mesh that can open a gap when a pane breaks; one without is as before.
// If the library cannot start, the game still runs: enemies find no routes and stand still, and the start screen says so.
let navigation: Navigation;
let navigationFailed = false;
try {
  navigation = await Navigation.create(level.navigationGeometryWithoutFloorGlass, {}, level.floorGlass);
} catch (error) {
  console.error('Navigation could not load:', error);
  navigation = Navigation.unavailable();
  navigationFailed = true;
}
// Cover spots generated from the level's props, with the level file's hand fixes (decision 236; 5.2), keeping only those
// an enemy can stand on.
const spotOnMesh = new THREE.Vector3();
/** A spot counts as on the mesh if the mesh's floor there is within this far of its own height (the mesh floor sits a cell above 0). */
const onMeshUpM = 0.5;
const levelCoverPoints = levelCover(levelData).filter((point) => {
  const feet = new THREE.Vector3(point.xM, point.yM ?? 0, point.zM);
  return navigation.closestPoint(feet, spotOnMesh) && Math.hypot(spotOnMesh.x - feet.x, spotOnMesh.z - feet.z) < 0.05 && Math.abs(spotOnMesh.y - feet.y) < onMeshUpM;
});
const coverPoints = new CoverPoints(levelCoverPoints, level.collision);
const player = new Player(level.collision, spotRad(levelData.start));

// Weapons. A gun decides when a shot happens; the shooter finds where it lands; the effects listen.
const weaponEvents = new EventBus<WeaponEvents>();
const guns = { rifle: new Gun(weaponEvents, 'rifle', rifleConfig, true), pistol: new Gun(weaponEvents, 'pistol', pistolConfig, false) };
const weapons = new WeaponSet(weaponEvents, guns.rifle, guns.pistol, new Knife(weaponEvents));
const viewmodel = new Viewmodel(weaponEvents); // the weapon in hand, drawn in its own pass after the world
viewmodel.setAspect(window.innerWidth / window.innerHeight);
const aim = new Aim();
const gunConfigs = { rifle: rifleConfig, pistol: pistolConfig };
const dummies = levelData.dummies.map(spotRad).map(({ xM, zM, yawRad }) => new Dummy(xM, zM, yawRad));
const dummyViews = dummies.map((dummy) => new DummyView(dummy));
for (const view of dummyViews) scene.add(view.group);
// The stand-in enemy (4.1): temporary, it walks the navigation mesh (4.2) to cover that hides it from Rook (4.3) and
// shoots when it sees him. Its hits go to his health (made further down). It sees from Rook's real eyes, lean included.
// Rook's hidden exposure meter (4.5) sets its hit chance; what the stand-in sees of him fills it.
const exposure = new Exposure();
const glimpses: Glimpse[] = [];
const projected = new THREE.Vector3();
const quarry = {
  position: player.position,
  get eyeHeightNowM() {
    return player.eyeHeightNowM;
  },
  eyes: camera.position,
  forward: new THREE.Vector3(0, 0, -1), // set from the camera every update
  /** On screen: inside the camera's view once projected (a point behind the camera ends up outside it). */
  inView(point: THREE.Vector3) {
    projected.copy(point).project(camera);
    return Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1 && Math.abs(projected.z) <= 1;
  },
  get exposure() {
    return exposure.value;
  },
  get movingFast() {
    return player.isSprinting || player.stance.stance === 'sliding';
  },
};
// Since 4.6 there are four, a squad: the coordinator hands out firing slots and keeps one hit budget for all of them.
// Each has its own world (it remembers where it last saw Rook from). The dev panel's count says how many are in the room.
const squad = new SquadCoordinator();
const standIns = levelData.spawns.map(spotRad).map((spawn) => {
  const world = new StandInWorld(
    weaponEvents,
    level.collision,
    navigation,
    coverPoints,
    quarry,
    (amount, from) => playerHealth.damage(amount, 'enemy', from),
    () => grenades.livePositions(), // the grenade system is made further down
    Math.random,
    squad,
    (from, velocity) => grenades.throwEnemyGrenade(from, velocity), // enemy grenades (4.12)
  );
  const enemy = new StandInEnemy(spawn, world);
  const view = new StandInView(enemy);
  scene.add(view.group);
  return { enemy, world, view };
});
const worldOf = new Map(standIns.map(({ enemy, world }) => [enemy, world]));
/** A callout hook (4.14, dialogue.md): sent only when the AI really does the thing; phase 6 voices it. */
const calloutAt = new THREE.Vector3();
function callout(kind: CalloutKind, enemy: StandInEnemy, side?: 'left' | 'right'): void {
  calloutAt.set(enemy.xM, enemy.yM + enemy.heightM, enemy.zM);
  weaponEvents.emit('enemy:callout', { kind, speaker: enemy, role: enemy.role, position: calloutAt, side });
}
/** Dev readout: why the last flank attempt found nothing, or null. */
let flankFailure: string | null = null;
/**
 * Starts a suppress-and-advance play (4.9) with up to `movers` moving up: the one with the shortest walk, then the others
 * nearest Rook, each to its own spot; one suppressor covers them (the heavy first). Nothing moves without that cover.
 */
function startPlay(movers: number): void {
  const candidates = activeEnemies.filter((enemy) => enemy.canAdvance && enemy.role !== 'flanker'); // flankers flank
  const play = squad.assignAdvance(
    candidates,
    (enemy) => worldOf.get(enemy)?.planAdvance(enemy) ?? null,
    coverers(null),
    (enemy) => enemy.role === 'heavy', // the heavy lays down the covering fire first
    (enemy) => enemy.firesOnTheMove,
  );
  if (!play) return;
  // Who covers each mover (4.17): the suppressor, or the heavy's own fire; if that stops on the way, the mover holds.
  play.advancer.member.beginAdvance(play.advancer.plan.point, play.suppressor ? 'squad' : 'self'); // claims its spot before the next one plans
  callout('advance_start', play.advancer.member);
  if (play.suppressor) {
    play.suppressor.beginSuppress(); // none when the mover is the heavy: it fires on the move (decision 237)
    callout('suppress_start', play.suppressor);
  }
  const nearestFirst = candidates
    .filter((enemy) => enemy !== play.advancer.member && enemy !== play.suppressor)
    .sort((a, b) => a.feet.distanceTo(player.position) - b.feet.distanceTo(player.position));
  let moving = 1;
  for (const enemy of nearestFirst) {
    if (moving >= movers) break;
    const plan = worldOf.get(enemy)?.planAdvance(enemy);
    if (!plan) continue;
    enemy.beginAdvance(plan.point, play.suppressor ? 'squad' : null); // behind a moving heavy, nobody's fire is theirs to wait for
    callout('advance_start', enemy);
    squad.addAdvancer(enemy);
    moving++;
  }
}
// Hearing Rook's gun (4.10): an awake stand-in that hears him run dry, reload or jam opens a push window; firing, the end
// of the reload or clearing the jam closes it.
const pushKinds: Partial<Record<NoiseKind, PushKind>> = { 'empty-click': 'dry', reload: 'reload', jam: 'jam' };
weaponEvents.on('noise:made', (noise) => {
  const kind = pushKinds[noise.kind];
  if (kind && activeEnemies.some((enemy) => enemy.awake && enemy.canHear(noise))) squad.heard(kind);
});
weaponEvents.on('weapon:fired', () => squad.closeWindow('dry'));
weaponEvents.on('weapon:reloaded', () => {
  squad.closeWindow('dry');
  squad.closeWindow('reload');
});
weaponEvents.on('weapon:interrupted', () => squad.closeWindow('reload'));
weaponEvents.on('weapon:jam-cleared', () => squad.closeWindow('jam'));
/**
 * A stand-in moves on to another spot (decision 237): one at a time; with covering fire if someone is free, by a route
 * mostly out of Rook's view, or always for the heavy (it fires on the move). Otherwise it stays and asks after its next peek.
 */
function reposition(enemy: StandInEnemy): void {
  if (squad.repositioner !== null) return; // someone else is moving on: it waits its turn
  const plan = worldOf.get(enemy)?.planReposition(enemy);
  if (!plan) {
    enemy.repositionDeclined();
    return;
  }
  const hiddenRoute = plan.exposedM <= squadConfig.repositionMaxExposedM;
  const selfCovers = enemy.firesOnTheMove && squad.suppressionAllowed; // at Cautious the heavy suppresses nothing (4.11)
  const cover = selfCovers || hiddenRoute ? null : squad.assignCover(coverers(enemy), (other) => other.role === 'heavy');
  if (!selfCovers && !hiddenRoute && !cover) {
    enemy.repositionDeclined();
    return;
  }
  squad.assignReposition(enemy);
  enemy.beginReposition(plan.point, selfCovers ? 'self' : cover ? 'squad' : null); // a hidden route needs no cover
  callout('advance_start', enemy);
  if (cover) {
    cover.beginSuppress();
    callout('suppress_start', cover);
  }
}
/**
 * Starts the hunt (decision 235) once the squad's knowledge of Rook is old: they all take the freshest last known spot,
 * one leads to cover near it (a flanker first, never the heavy), and one watches from its cover (the heavy first).
 */
function startHunt(): void {
  const knowing = activeEnemies.filter((enemy) => enemy.awake && enemy.knowsWhere);
  if (knowing.length === 0) return;
  const freshest = knowing.reduce((best, enemy) => (enemy.lastKnownAgeSec < best.lastKnownAgeSec ? enemy : best));
  const spot = freshest.lastKnown.clone();
  for (const enemy of knowing) enemy.shareLastKnown(spot, freshest.lastKnownAgeSec);
  const lead = squad.beginHunt(
    spot,
    activeEnemies.filter((enemy) => enemy.canFlank), // a heavy never flanks, so it never leads
    (enemy) => worldOf.get(enemy)?.planHuntSpot(enemy) ?? null,
    (enemy) => enemy.role === 'flanker',
  );
  if (!lead) return;
  lead.member.beginHunt(lead.plan.point, true);
  callout('player_lost', lead.member);
  squad.assignWatcher(
    activeEnemies.filter((enemy) => enemy !== lead.member && enemy.canAdvance),
    (enemy) => enemy.role === 'heavy',
  );
}
/** A follow step of the hunt: up to the tier's followers, nearest the spot first, each to cover closer to it but not past the leader. */
function huntStep(): void {
  squad.huntStepStarted();
  const spot = squad.huntSpot;
  const fromSpotM = (xM: number, zM: number) => Math.hypot(xM - spot.x, zM - spot.z);
  const leaderCover = activeEnemies.find((enemy) => enemy === squad.huntLeader)?.cover;
  const closestM = Math.max(squadConfig.advanceClosestM, leaderCover ? fromSpotM(leaderCover.xM, leaderCover.zM) : 0);
  const followers = activeEnemies
    .filter((enemy) => enemy.canAdvance && enemy !== squad.huntLeader && enemy !== squad.huntWatcher)
    .sort((a, b) => fromSpotM(a.xM, a.zM) - fromSpotM(b.xM, b.zM));
  let moving = 0;
  for (const enemy of followers) {
    if (moving >= Math.round(squad.tier.huntFollowers)) break;
    const plan = worldOf.get(enemy)?.planAdvance(enemy, closestM);
    if (!plan) continue;
    enemy.beginHunt(plan.point, false); // claims its spot before the next one plans
    callout('advance_start', enemy);
    squad.addHuntFollower(enemy);
    moving++;
  }
}
/** The stand-ins that could pin Rook's cover now (4.9), leaving out `mover`. */
const coverers = (mover: StandInEnemy | null): StandInEnemy[] =>
  activeEnemies.filter((enemy) => enemy !== mover && enemy.canSuppress && (worldOf.get(enemy)?.canSuppressFrom(enemy) ?? false));
// Suppressing fire on one side of Rook's cover pins that side (the exposure meter); his own near misses pin enemies (4.9).
weaponEvents.on('cover:pinned', ({ anchor, side }) => exposure.pin(anchor, side));
weaponEvents.on('shot:landed', ({ shooter, muzzle, end }) => {
  if (shooter !== 'player') return;
  for (const enemy of activeEnemies) if (worldOf.get(enemy)?.nearMiss(enemy, muzzle, end) && enemy.pinDown()) callout('suppressed', enemy);
});
/** The storey push (decision 277): sends a climber when Rook fights from another floor and the squad only waits below. */
const storeyPush = new StoreyPush();
/** The stand-ins in the room now (the first few of `standIns`); changed in place by `placeSquad`. */
const activeStandIns: typeof standIns = [];
const activeEnemies: StandInEnemy[] = [];
// Each stand-in keeps its line of fire clear of the others in the room (4.16).
for (const { world } of standIns) {
  world.squadmates = activeEnemies;
  world.glass = level.glass; // their misses prefer to strike glass near Rook (5.4)
}
/** Keeping apart (4.16): each stand-in's body, and whether it holds its spot (in cover, or standing) this update. */
const spacedBodies = standIns.map(({ enemy }) => ({ feet: enemy.feet, fixed: false, enemy }));
const spacedMoved: typeof spacedBodies = [];
const spacedNow: typeof spacedBodies = [];
/** Playtests (4.16): how long every stand-in in the room has been down. */
let allDownSec = 0;
weaponEvents.on('noise:made', (noise) => activeEnemies.forEach((enemy) => enemy.hear(noise, player.position.y)));
// Everything the player's bullets, knife and grenades can hurt. Filled by `placeSquad`, which changes it in place.
const targets: Target[] = [];
const shooter = new Shooter(weaponEvents, level.collision, camera, viewmodel.muzzles, targets, gunConfigs);
new KnifeStrike(weaponEvents, level.collision, camera, targets);
const tracers = new Tracers(scene, weaponEvents);
// Breakable glass (5.4): bullets and blasts crack and shatter panes; the effects show it, the sound and the noise follow.
const glassSystem = new GlassSystem(weaponEvents, level, navigation);
const glassFx = new GlassFx(scene, weaponEvents, level.glassMeshes);
const impactSparks = new ImpactSparks(scene, weaponEvents);
const barrelSmoke = new BarrelSmoke(scene, camera, viewmodel.muzzles.rifle);
// Sound: the audio system starts from the Play click (browser rule); the weapon sounds listen to the weapon events.
const audio = new AudioSystem(scene, camera);
const sounds = new SoundTap(audio, () => audio.running); // every sound passes through it; the dev panel's captions listen
const weaponSounds = new WeaponSounds(weaponEvents, sounds);
new NoiseReporter(weaponEvents, () => camera.position);
// Movement sounds (3.4): the reporter says what the player did, the sounds and the noise service listen.
const movement = new MovementReporter(weaponEvents, player, (x, y, z) => surfaceAt(x, y, z, levelData.boxes, levelFloor.floors));
new MovementSounds(weaponEvents, sounds);
// Enemy sounds (4.14): footsteps counted by distance moved, and each gun's shot.
new EnemySounds(weaponEvents, sounds);
const enemySteps = new EnemySteps(weaponEvents, (x, y, z) => surfaceAt(x, y, z, levelData.boxes, levelFloor.floors));
weaponEvents.on('enemy:downed', ({ position }) => {
  const caller = downCaller(activeEnemies, position); // the one that fell is no longer awake
  if (caller) callout('squadmate_down', caller);
});
player.onLanded = (speedMps) => {
  playerHealth.damage(fallDamage(speedMps), 'fall');
  movement.landed(speedMps);
}; // what the player does that enemies could hear (they listen from 4.10)
const casings = new Casings(scene, weaponEvents, level.collision, camera, viewmodel.ejectionPorts);
// R: a tap reloads, a hold checks the magazine. F: a hold inspects the weapon.
const reloadKey = new HoldTap();
const inspectKey = new HoldTap();
const bulletMarks = new BulletMarks(scene, weaponEvents);
// Grenades: G throws one (the thrower holds the rules), the system flies it and works out the blast, and the effects listen.
const thrower = new GrenadeThrower(weaponEvents);
// What dead contractors drop (4.12): a grenade they still carried, and a magazine that fits one of Rook's guns. He picks
// them up by walking over them (a grenade only below his carry limit).
const pickups = new Pickups(weaponEvents, (kind) => {
  if (kind === 'grenade') return thrower.give(1) > 0;
  guns[kind].magazines.addFull();
  return true;
});
const pickupsView = new PickupsView(scene, pickups);
const blastTargets: ReturnType<typeof dummyBlastTarget>[] = [];

/**
 * Puts the squad back: every stand-in idle at its spawn, the first `standInCount` of them in the room (seen, hit, heard,
 * updated), the rest hidden; and the hit and blast target lists to match. At start, restart and the dev panel's Respawn.
 */
function placeSquad(): void {
  const count = Math.min(Math.max(Math.round(squadConfig.standInCount), 1), standIns.length);
  activeStandIns.length = 0;
  standIns.forEach((standIn, i) => {
    standIn.enemy.reset();
    standIn.view.group.visible = i < count;
    if (i < count) activeStandIns.push(standIn);
  });
  activeEnemies.length = 0;
  activeEnemies.push(...activeStandIns.map((standIn) => standIn.enemy));
  storeyPush.reset();
  targets.length = 0;
  targets.push(...dummies, ...activeEnemies);
  blastTargets.length = 0;
  blastTargets.push(...targets.map((target) => dummyBlastTarget(target, weaponEvents)));
  squad.reset();
}
placeSquad();
const playerHealth = new PlayerHealth(weaponEvents);
const heals = new HealItems(weaponEvents, playerHealth);
const playerBlastTarget = {
  chest: (out: THREE.Vector3) => out.set(player.position.x, player.position.y + grenadeConfig.targetChestHeightM, player.position.z),
  vulnerable: () => !playerHealth.dead,
  hurt: (damage: number) => playerHealth.damage(damage, 'blast'),
};
const grenades = new GrenadeSystem(scene, weaponEvents, level.collision, camera, blastTargets, playerBlastTarget);
const explosions = new Explosions(scene, weaponEvents, level.collision);
const cameraShake = new CameraShake(weaponEvents, () => camera.position);
// The HUD, and health shown through the screen. Made before the overlays so they cover them.
const hud = createHud(weaponEvents, viewmodel);
const healthFeel = new HealthFeelState();
const healthScreen = new HealthScreen(renderer.domElement);
const healthSounds = new HealthSounds(sounds);
weaponEvents.on('player:damaged', ({ amount }) => healthFeel.hit(amount));

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  viewmodel.setAspect(window.innerWidth / window.innerHeight);
});

// Wiring: input, the play state, pointer lock, focus, overlay, loop.
const input = new Input();
attachInputListeners(input, renderer.domElement);

// `pointerLock` is assigned just below; the game only calls releaseMouse later, never during construction.
const game = new Game(input, () => pointerLock.exit());
const pointerLock = createPointerLock(
  renderer.domElement,
  (locked) => game.handleLockChange(locked),
  () => game.handleCaptureRefused(),
);
onFocusLost(() => game.handleFocusLost());
// The level editor (dev only) runs with a free cursor; holding the right button captures the mouse to look around (5.2d).
captureWhileHeld(renderer.domElement, editorLookButton, pointerLock, () => game.editing);

// The click that starts or resumes the game is the one the browser lets sound start from.
const overlay = createOverlay(() => {
  audio.unlock();
  void pointerLock.request();
});
overlay.show(navigationFailed ? `${uiText.clickToPlay}. ${uiText.navigationFailed}` : uiText.clickToPlay);

// Death (milestone 3.1): the world freezes under a line of text until Enter, which restarts at once (no page reload).
// The real death screen is 7.3. The overlay is made after the pause overlay so it sits on top, and clicking it resumes too.
const deathOverlay = createOverlay(() => void pointerLock.request());
deathOverlay.hide();
let dead = false;
weaponEvents.on('player:died', () => {
  dead = true;
  input.consumePress('Enter'); // a stale press must not restart at once
  deathOverlay.show(uiText.died);
});

function restart(): void {
  dead = false;
  deathOverlay.hide();
  playerHealth.reset();
  player.respawn();
  movement.reset();
  weapons.reset();
  thrower.reset();
  heals.reset();
  grenades.clear();
  pickups.clear();
  dummies.forEach((dummy) => dummy.reset());
  placeSquad();
  coverPoints.clearClaims();
  bulletMarks.clear();
  glassSystem.reset();
  glassFx.clear();
  tracers.clear();
  impactSparks.clear();
  exposure.reset();
  casings.clear();
  explosions.clear();
  barrelSmoke.clear();
  cameraShake.reset();
  healthFeel.reset();
  healthScreen.update(healthFeel);
  shooter.recoil.reset();
  reloadKey.reset();
  inspectKey.reset();
}
game.events.on('game:playing', () => {
  overlay.hide();
  reloadKey.reset(); // a key that was down when the game paused must not count as a tap on resume
  inspectKey.reset();
});
game.events.on('game:paused', () => {
  overlay.show(uiText.paused);
  audio.suspend(); // sound freezes under the pause menu
});
game.events.on('game:capture-refused', () => overlay.show(uiText.captureRefused));

// Debug tools (tuning panel, free camera) exist only on the dev server. Vite removes this block from the production
// build, so neither the tools nor lil-gui are shipped to players.
let debug: DebugTools | null = null;
if (import.meta.env.DEV) {
  void import('./debug').then((tools) => {
    debug = tools.installDebugTools({ scene, input, player, viewmodel, weapons, audio, thrower, health: playerHealth, heals, soundTap: sounds, standIns: standIns.map((standIn) => standIn.enemy), activeStandIns: activeEnemies, squad, respawnSquad: placeSquad, flankFailure: () => flankFailure, navigation, coverPoints, camera, exposure, hitChance: () => standIns[0].world.hitChance(), renderer, collision: level.collision, events: weaponEvents, level: levelData, levelBoxMeshes: level.boxMeshes, setEditing: (on) => game.setEditing(on) });
  });
}

// An inspect only starts when nothing else is going on (the animator drops it otherwise), so its sounds match.
function canInspect(): boolean {
  const gun = weapons.gun;
  const busy = thrower.busy || weapons.drawing || player.isSprinting || aim.eased > 0.05 || (gun !== null && (gun.reloading || gun.checking || gun.jammed));
  return !busy;
}

const animatorInput: AnimatorInput = { weapon: 'rifle', drawProgress: 1, reloadProgress: null, sprinting: false };
let lastFrameMs = performance.now();
const maxFrameSec = 0.1; // a long pause must not make the weapon jump

const loop = new Loop(
  (stepSec) => {
    if (debug?.freeCameraActive) return; // the player is frozen while the free camera flies
    if (dead) {
      if (input.consumePress('Enter')) restart();
      return;
    }
    if (standsOnHazard(player.position.x, player.position.y, player.position.z, levelFloor.hazards)) {
      playerHealth.damage(healthConfig.hazardDamagePerSec * stepSec, 'hazard');
    }
    playerHealth.update(stepSec);
    healthFeel.update(stepSec, playerHealth.current);
    healthSounds.update(healthFeel);
    healthScreen.update(healthFeel);
    // Aiming is allowed with a gun out that is not being drawn, and not while sprinting, climbing or vaulting.
    // Reloading does not stop it (owner's choice).
    const gunInHand = weapons.gun;
    const canAim = gunInHand !== null && !weapons.drawing && !thrower.busy && !heals.busy && !player.isSprinting && !player.mantle.active;
    aim.update(stepSec, canAim && input.isButtonDown(aimButton), gunInHand ? gunConfigs[gunInHand.id] : null);
    player.speedScale = aim.moveSpeedScale;
    shooter.aimBlend = aim.eased;

    player.handsBusy = heals.busy;
    player.fixedUpdate(stepSec, input);
    movement.update();
    pickups.update(player.position);
    pickupsView.update(stepSec);
    // R and F: tap or hold. Their presses are consumed so nothing stale is remembered.
    input.consumePress('KeyR');
    input.consumePress('KeyF');
    reloadKey.update(stepSec, input.isKeyDown('KeyR'), inputConfig.holdTimeSec);
    inspectKey.update(stepSec, input.isKeyDown('KeyF'), inputConfig.holdTimeSec);
    // Every press is consumed each update, so a click that could not be used is not remembered for later.
    let select: WeaponId | null = null;
    for (const [code, weapon] of Object.entries(weaponKeys)) if (input.consumePress(code)) select = weapon;
    // G: throw a grenade. Not while sprinting, climbing, vaulting, drawing, reloading or checking the magazine.
    const gunBusy = weapons.drawing || (gunInHand !== null && (gunInHand.reloading || gunInHand.checking));
    thrower.update(stepSec, {
      pressed: input.consumePress('KeyG'),
      canThrow: !player.isSprinting && !player.mantle.active && !gunBusy && !heals.busy,
    });
    if (thrower.justFinished) weapons.redraw(); // the weapon comes back up after the throw
    // While the hands are busy with the grenade nothing else can be done with the weapons.
    // H: use a heal item. Same hands rules as a throw; the health lands when the use ends.
    heals.update(stepSec, { pressed: input.consumePress('KeyH'), canUse: !player.mantle.active && !thrower.busy && !gunBusy });
    const handsFree = !thrower.busy && !heals.busy;
    if (!handsFree) select = null;
    const wheelSteps = input.consumeWheelSteps();
    weapons.update(stepSec, {
      select,
      wheelSteps: handsFree ? wheelSteps : 0,
      triggerHeld: handsFree && input.isButtonDown(fireButton),
      triggerPressed: input.consumeButtonPress(fireButton) && handsFree,
      reloadPressed: reloadKey.tapped && handsFree,
      checkRequested: reloadKey.holdStarted && handsFree,
      reloadHeld: handsFree && input.isKeyDown('KeyR'),
      canFire: handsFree && !player.isSprinting && !player.mantle.active,
    });
    if (inspectKey.holdStarted && canInspect()) {
      viewmodel.inspect();
      const length = weapons.current === 'knife' ? viewmodelConfig.inspectKnifeSec : viewmodelConfig.inspectGunSec;
      weaponEvents.emit('weapon:inspect-started', { weapon: weapons.current, durationSec: length });
    }
    shooter.recoil.update(stepSec);
    tracers.update(stepSec);
    impactSparks.update(stepSec);
    glassFx.update(stepSec);
    casings.update(stepSec);
    weaponSounds.update(stepSec);
    audio.update(stepSec);
    grenades.update(stepSec);
    explosions.update(stepSec);
    cameraShake.update(stepSec);
    barrelSmoke.update(stepSec, weapons.rifleHeat, weapons.current === 'rifle');
    dummies.forEach((dummy, i) => {
      dummy.update(stepSec);
      dummyViews[i].update();
    });
    camera.getWorldDirection(quarry.forward);
    const aiStartMs = performance.now(); // the AI's time, for the dev performance readout (4.13b)
    // The squad times how long Rook holds his spot while it knows where he is, and sends a flanker when he holds it too long.
    const squadKnows = activeEnemies.some((enemy) => enemy.awake && enemy.knowsFresh);
    const rookHidden = glimpses.length > 0 && glimpses.every((glimpse) => glimpse.visibleShare <= 0); // as of the last update
    squad.update(stepSec, squadKnows ? player.position : null, rookHidden);
    // The hunt (decision 235): once its knowledge has been old long enough, the squad comes looking, cover by cover.
    squad.watchKnowledge(stepSec, activeEnemies.some((enemy) => enemy.awake), squadKnows);
    if (squad.huntDue) startHunt();
    if (squad.huntStepDue) huntStep();
    // A push (4.10): a moment after the squad heard his gun run dry, reload or jam. A jam also starts a flank at once.
    const push = squad.pushDue;
    if (push) {
      squad.pushStarted(); // one push per window
      const caller = pushCaller(activeEnemies, player.position);
      if (caller) callout(push === 'jam' ? 'player_jammed' : 'player_dry', caller); // a reload push: "he's reloading, push"
      if (push === 'jam') squad.forceFlank(); // "flankers commit": the flank below starts this update
      const { pushMoversDry, pushMoversReload, pushMoversJam } = squad.tier; // per aggression tier (4.11)
      const movers = { dry: pushMoversDry, reload: pushMoversReload, jam: pushMoversJam }[push];
      if (!squad.playRunning && movers > 0) startPlay(Math.round(movers));
    }
    if (squad.flankDue) {
      // The job goes to the enemy itself: that is who tells the squad when its flank is over.
      const candidates = activeEnemies.filter((enemy) => enemy.canFlank);
      const job = squad.assignFlank(
        candidates,
        (enemy) => worldOf.get(enemy)?.planFlank(enemy) ?? null,
        (enemy) => enemy.role === 'flanker', // flankers first; the others only if no flanker can (decision 217)
      );
      if (job) {
        job.member.beginFlank(job.plan.point);
        // The pincer (4.11, Aggressive and up): a second flanker round his other side at the same time, if one can go.
        const side = worldOf.get(job.member)?.flankSide(job.plan.point) ?? 0;
        callout('flank_start', job.member, sideWord(side));
        const second = squad.assignPincer(
          candidates.filter((enemy) => enemy !== job.member),
          (enemy) => worldOf.get(enemy)?.planFlank(enemy, -side) ?? null,
          (enemy) => enemy.role === 'flanker',
        );
        if (second) {
          second.member.beginFlank(second.plan.point);
          callout('flank_start', second.member, sideWord(worldOf.get(second.member)?.flankSide(second.plan.point) ?? 0));
        }
        // Covering fire for the flank if someone is free (decision 225); the flank does not wait for it.
        const flankCover = squad.assignCover(coverers(job.member), (enemy) => enemy.role === 'heavy');
        if (flankCover) {
          flankCover.beginSuppress();
          callout('suppress_start', flankCover);
        }
      }
      // For the dev readout: why the attempt found nothing (the spot rules, as the first candidate saw them).
      const first = candidates.find((enemy) => enemy.role === 'flanker') ?? candidates[0];
      const rejects = first ? worldOf.get(first)?.flankRejects : undefined;
      flankFailure = job ? null : rejects ? describeFlankRejects(rejects) : 'nobody can be sent (wounded, busy, or heavies only)';
    }
    // The storey push (decision 277): Rook fights from another floor and part of the squad only waits below: one of them,
    // not the leader if another can, leaves cover and climbs to him, a squadmate pinning his cover meanwhile.
    const inTheFight = activeEnemies.filter((enemy) => enemy.awake && enemy.state !== 'down' && enemy.state !== 'falling');
    const climber = storeyPush.update(stepSec, squadKnows ? player.position.y : null, inTheFight, squad.tier, squadConfig.sameFloorM, squadConfig.storeyPushGapSec, (enemy) => enemy.role !== 'leader');
    if (climber) {
      climber.beginClimb();
      const climbCover = squad.assignCover(coverers(climber), (enemy) => enemy.role === 'heavy');
      if (climbCover) {
        climbCover.beginSuppress();
        callout('suppress_start', climbCover);
      }
    }
    // Enemy grenades (4.12): when Rook has held one spot well past the flank, the nearest enemy with a grenade and a clear
    // lob throws it from a peek. One in the air at a time, and a wait between throws.
    if (squad.grenadeDue(grenades.enemyGrenadeLive)) {
      const job = squad.assignGrenade(
        activeEnemies.filter((enemy) => enemy.canThrow),
        (enemy) => worldOf.get(enemy)?.planThrow(enemy) ?? null,
      );
      job?.member.beginThrow(job.plan);
    }
    // Suppress and advance (4.9): while Rook hides, one moves up to closer cover while another pins his cover. How many
    // move is per tier: at Relentless everyone who can, cover by cover (the coordinated push, 4.11).
    if (squad.playDue) startPlay(Math.round(squad.tier.playMovers));
    // Repositioning (decision 237): one stand-in that has used its spot enough moves on, if the squad allows it.
    const mover = activeEnemies.find((enemy) => enemy.wantsToReposition);
    if (mover) reposition(mover);
    // Held pushes (4.17): a mover whose covering fire stopped holds at near cover and asks again every so often. Covered
    // again (a free suppressor, the heavy first; one already pinning; or the heavy's own reload done), it goes on.
    for (const enemy of activeEnemies) {
      if (!enemy.asksForCover) continue;
      enemy.askedForCover();
      const goal = enemy.heldPushGoal;
      if (!goal || !worldOf.get(enemy)?.canResumeTo(enemy, goal)) {
        enemy.dropHeldPush(); // its spot was taken or no longer hides it: it fights from where it is
        continue;
      }
      if (enemy.heldBySelf) {
        if (enemy.reloading) continue;
      } else if (squad.suppressor === null) {
        const cover = squad.assignCover(coverers(enemy), (other) => other.role === 'heavy');
        if (!cover) continue;
        cover.beginSuppress();
        callout('suppress_start', cover);
      }
      enemy.resumePush(enemy.heldBySelf ? 'self' : 'squad');
      squad.addAdvancer(enemy);
      callout('advance_start', enemy);
    }
    glimpses.length = 0;
    for (const { enemy, world, view } of activeStandIns) {
      enemy.update(stepSec, player.position);
      view.update();
      glimpses.push(world.glimpse(enemy, stepSec));
    }
    exposure.update(stepSec, glimpses, player.stance.stance === 'crouching', camera.position);
    // Keeping apart (4.16): bodies that ended this update overlapping are pushed apart (a moving one steps aside), then
    // out of walls and props again. The ones lying down are left out.
    spacedNow.length = 0;
    for (const body of spacedBodies) {
      if (!activeEnemies.includes(body.enemy) || body.enemy.state === 'down' || body.enemy.state === 'falling') continue;
      body.fixed = body.enemy.state === 'cover' || body.enemy.speedMps === 0;
      spacedNow.push(body);
    }
    keepApart(spacedNow, 2 * standInConfig.capsuleRadiusM, spacedMoved, dummyConfig.heightM);
    for (const { enemy } of spacedMoved) worldOf.get(enemy)?.pushOut(enemy.feet);
    enemySteps.update(stepSec, activeEnemies);
    // Playtests (4.16): the whole squad comes back together, the respawn delay after the last one is down.
    if (squadConfig.respawnTogether && activeEnemies.length > 0 && activeEnemies.every((enemy) => enemy.state === 'down')) {
      allDownSec += stepSec;
      if (allDownSec >= standInConfig.respawnDelaySec) {
        allDownSec = 0;
        placeSquad();
        for (const enemy of activeEnemies) enemy.getUpWithSquad();
      }
    } else {
      allDownSec = 0;
    }
    debug?.perf.addAi(performance.now() - aiStartMs);
  },
  (alpha) => {
    // The free camera, when on, places the camera itself; otherwise the player does.
    let lookYawRad = 0;
    let lookPitchRad = 0;
    if (!debug?.beforeRender(camera)) {
      player.look(input, aim.sensitivityScale);
      lookYawRad = player.lookYawDeltaRad;
      lookPitchRad = player.lookPitchDeltaRad;
      const fovDeg = aim.fovDeg(viewConfig.baseFovDeg);
      if (camera.fov !== fovDeg) {
        camera.fov = fovDeg;
        camera.updateProjectionMatrix();
      }
      player.applyToCamera(camera, alpha, shooter.recoil.pitchRad + cameraShake.pitchRad, shooter.recoil.yawRad + cameraShake.yawRad);
    }
    // The weapon animates with real time, every screen frame, so it stays smooth on fast screens.
    const nowMs = performance.now();
    const frameSec = Math.min((nowMs - lastFrameMs) / 1000, maxFrameSec);
    lastFrameMs = nowMs;
    const gun = weapons.gun;
    // One input object reused every frame, so nothing is allocated here.
    animatorInput.weapon = thrower.busy ? 'grenade' : weapons.current;
    animatorInput.throwProgress = thrower.progress;
    animatorInput.throwReleaseShare = thrower.releaseShare;
    animatorInput.drawProgress = weapons.drawProgress;
    animatorInput.reloadProgress = gun?.reloading ? gun.reloadProgress : null;
    animatorInput.reloadRackShare = gun?.reloadRackShare ?? 0;
    animatorInput.checkProgress = gun?.checking ? gun.checkProgress : null;
    animatorInput.lockedOpen = gun?.empty ?? false;
    animatorInput.jammed = gun?.jammed ?? false;
    animatorInput.sprinting = player.isSprinting;
    animatorInput.aimBlend = aim.eased;
    // The bob only runs while walking on the ground, not while sliding, climbing or in the air.
    const walking = player.grounded && !player.mantle.active && player.stance.stance !== 'sliding';
    animatorInput.speedMps = walking ? player.speedMps : 0;
    animatorInput.crouching = player.stance.stance === 'crouching';
    animatorInput.lookYawRad = lookYawRad;
    animatorInput.lookPitchRad = lookPitchRad;
    viewmodel.update(frameSec, animatorInput);
    hud.update({ weapons, aimBlend: aim.eased, grenades: thrower.count, heals: heals.count, healing: heals.busy, camera, enemyGrenades: grenades.liveEnemyGrenades() });
    const renderStartMs = performance.now();
    renderer.clear();
    renderer.render(scene, camera);
    if (!debug?.freeCameraActive) {
      // The weapon is drawn over the world, so it never sinks into walls. Not while the free camera (and the level editor) flies.
      renderer.clearDepth();
      renderer.render(viewmodel.scene, viewmodel.camera);
    }
    debug?.perf.addRender(performance.now() - renderStartMs);
  },
  () => game.isPlaying,
);
loop.start();
