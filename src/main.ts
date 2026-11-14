import * as THREE from 'three';
import { Game } from './core/game';
import { Input } from './core/input';
import { Loop } from './core/loop';
import { uiText } from './data/uiText';
import type { DebugTools } from './debug';
import { buildGreybox } from './level/greybox';
import { Navigation } from './level/navigation';
import { CoverPoints, coverPointsFromBoxes } from './level/cover';
import { onFocusLost } from './platform/focus';
import { attachInputListeners } from './platform/inputListeners';
import { createPointerLock } from './platform/pointerLock';
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
import { testArena, testArenaDummies, testArenaLayout, testArenaStandIns, testArenaStart } from './data/testArena';
import { Dummy } from './enemies/dummy';
import { DummyView } from './enemies/dummyView';
import { StandInEnemy } from './enemies/standInEnemy';
import { StandInView } from './enemies/standInView';
import { describeFlankRejects, StandInWorld } from './enemies/standInWorld';
import type { Target } from './enemies/target';
import { squadConfig } from './config/squad';
import { SquadCoordinator, type PushKind } from './squad/squadCoordinator';
import type { NoiseKind } from './stealth/noise';
import { BulletMarks } from './fx/bulletMarks';
import { Tracers } from './fx/tracers';
import { ImpactSparks } from './fx/impactSparks';
import { Exposure, type Glimpse } from './player/exposure';
import { pistolConfig } from './config/pistol';
import { viewConfig } from './config/view';
import { grenadeConfig } from './config/grenade';
import { inputConfig } from './config/input';
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

// The test arena (decision 236): larger than the old test room, built to the chamber rules, replaced in phase 5.
const level = buildGreybox(testArena, testArenaLayout);
scene.add(level.group);
// The navigation mesh (4.2): built once from the room, where enemies can walk. Takes milliseconds, before the first frame.
// If the library cannot start, the game still runs: enemies find no routes and stand still, and the start screen says so.
let navigation: Navigation;
let navigationFailed = false;
try {
  navigation = await Navigation.create(level.navigationGeometry);
} catch (error) {
  console.error('Navigation could not load:', error);
  navigation = Navigation.unavailable();
  navigationFailed = true;
}
// Cover spots generated from the arena's props (decision 236), keeping only those an enemy can stand on.
const spotOnMesh = new THREE.Vector3();
const arenaCover = coverPointsFromBoxes(testArena).filter((point) => {
  const feet = new THREE.Vector3(point.xM, 0, point.zM);
  return navigation.closestPoint(feet, spotOnMesh) && Math.hypot(spotOnMesh.x - feet.x, spotOnMesh.z - feet.z) < 0.05;
});
const coverPoints = new CoverPoints(arenaCover, level.collision);
const player = new Player(level.collision, testArenaStart);

// Weapons. A gun decides when a shot happens; the shooter finds where it lands; the effects listen.
const weaponEvents = new EventBus<WeaponEvents>();
const weapons = new WeaponSet(
  weaponEvents,
  new Gun(weaponEvents, 'rifle', rifleConfig, true),
  new Gun(weaponEvents, 'pistol', pistolConfig, false),
  new Knife(weaponEvents),
);
const viewmodel = new Viewmodel(weaponEvents); // the weapon in hand, drawn in its own pass after the world
viewmodel.setAspect(window.innerWidth / window.innerHeight);
const aim = new Aim();
const gunConfigs = { rifle: rifleConfig, pistol: pistolConfig };
const dummies = testArenaDummies.map(({ xM, zM, yawRad }) => new Dummy(xM, zM, yawRad));
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
const standIns = testArenaStandIns.map((spawn) => {
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
  );
  const enemy = new StandInEnemy(spawn, world);
  const view = new StandInView(enemy);
  scene.add(view.group);
  return { enemy, world, view };
});
const worldOf = new Map(standIns.map(({ enemy, world }) => [enemy, world]));
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
  play.advancer.member.beginAdvance(play.advancer.plan.point); // claims its spot before the next one plans
  play.suppressor?.beginSuppress(); // none when the mover is the heavy: it fires on the move (decision 237)
  const nearestFirst = candidates
    .filter((enemy) => enemy !== play.advancer.member && enemy !== play.suppressor)
    .sort((a, b) => a.feet.distanceTo(player.position) - b.feet.distanceTo(player.position));
  let moving = 1;
  for (const enemy of nearestFirst) {
    if (moving >= movers) break;
    const plan = worldOf.get(enemy)?.planAdvance(enemy);
    if (!plan) continue;
    enemy.beginAdvance(plan.point);
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
  enemy.beginReposition(plan.point);
  cover?.beginSuppress();
}
/** The stand-ins that could pin Rook's cover now (4.9), leaving out `mover`. */
const coverers = (mover: StandInEnemy | null): StandInEnemy[] =>
  activeEnemies.filter((enemy) => enemy !== mover && enemy.canSuppress && (worldOf.get(enemy)?.canSuppressFrom(enemy) ?? false));
// Suppressing fire on one side of Rook's cover pins that side (the exposure meter); his own near misses pin enemies (4.9).
weaponEvents.on('cover:pinned', ({ anchor, side }) => exposure.pin(anchor, side));
weaponEvents.on('shot:landed', ({ shooter, muzzle, end }) => {
  if (shooter !== 'player') return;
  for (const enemy of activeEnemies) if (worldOf.get(enemy)?.nearMiss(enemy, muzzle, end)) enemy.pinDown();
});
/** The stand-ins in the room now (the first few of `standIns`); changed in place by `placeSquad`. */
const activeStandIns: typeof standIns = [];
const activeEnemies: StandInEnemy[] = [];
weaponEvents.on('noise:made', (noise) => activeEnemies.forEach((enemy) => enemy.hear(noise)));
// Everything the player's bullets, knife and grenades can hurt. Filled by `placeSquad`, which changes it in place.
const targets: Target[] = [];
const shooter = new Shooter(weaponEvents, level.collision, camera, viewmodel.muzzles, targets, gunConfigs);
new KnifeStrike(weaponEvents, level.collision, camera, targets);
const tracers = new Tracers(scene, weaponEvents);
const impactSparks = new ImpactSparks(scene, weaponEvents);
const barrelSmoke = new BarrelSmoke(scene, camera, viewmodel.muzzles.rifle);
// Sound: the audio system starts from the Play click (browser rule); the weapon sounds listen to the weapon events.
const audio = new AudioSystem(scene, camera);
const sounds = new SoundTap(audio, () => audio.running); // every sound passes through it; the dev panel's captions listen
const weaponSounds = new WeaponSounds(weaponEvents, sounds);
new NoiseReporter(weaponEvents, () => camera.position);
// Movement sounds (3.4): the reporter says what the player did, the sounds and the noise service listen.
const movement = new MovementReporter(weaponEvents, player, (x, y, z) => surfaceAt(x, y, z, testArena, testArenaLayout.floors));
new MovementSounds(weaponEvents, sounds);
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
attachInputListeners(input);

// `pointerLock` is assigned just below; the game only calls releaseMouse later, never during construction.
const game = new Game(input, () => pointerLock.exit());
const pointerLock = createPointerLock(
  renderer.domElement,
  (locked) => game.handleLockChange(locked),
  () => game.handleCaptureRefused(),
);
onFocusLost(() => game.handleFocusLost());

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
  dummies.forEach((dummy) => dummy.reset());
  placeSquad();
  coverPoints.clearClaims();
  bulletMarks.clear();
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
    debug = tools.installDebugTools({ scene, input, player, viewmodel, weapons, audio, thrower, health: playerHealth, heals, soundTap: sounds, standIns: standIns.map((standIn) => standIn.enemy), activeStandIns: activeEnemies, squad, respawnSquad: placeSquad, flankFailure: () => flankFailure, navigation, coverPoints, camera, exposure, hitChance: () => standIns[0].world.hitChance() });
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
    if (standsOnHazard(player.position.x, player.position.y, player.position.z, testArenaLayout.hazards)) {
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
    // The squad times how long Rook holds his spot while it knows where he is, and sends a flanker when he holds it too long.
    const squadKnows = activeEnemies.some((enemy) => enemy.awake && enemy.knowsFresh);
    const rookHidden = glimpses.length > 0 && glimpses.every((glimpse) => glimpse.visibleShare <= 0); // as of the last update
    squad.update(stepSec, squadKnows ? player.position : null, rookHidden);
    // A push (4.10): a moment after the squad heard his gun run dry, reload or jam. A jam also starts a flank at once.
    const push = squad.pushDue;
    if (push) {
      squad.pushStarted(); // one push per window
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
        const second = squad.assignPincer(
          candidates.filter((enemy) => enemy !== job.member),
          (enemy) => worldOf.get(enemy)?.planFlank(enemy, -side) ?? null,
          (enemy) => enemy.role === 'flanker',
        );
        second?.member.beginFlank(second.plan.point);
        // Covering fire for the flank if someone is free (decision 225); the flank does not wait for it.
        squad.assignCover(coverers(job.member), (enemy) => enemy.role === 'heavy')?.beginSuppress();
      }
      // For the dev readout: why the attempt found nothing (the spot rules, as the first candidate saw them).
      const first = candidates.find((enemy) => enemy.role === 'flanker') ?? candidates[0];
      const rejects = first ? worldOf.get(first)?.flankRejects : undefined;
      flankFailure = job ? null : rejects ? describeFlankRejects(rejects) : 'nobody can be sent (wounded, busy, or heavies only)';
    }
    // Suppress and advance (4.9): while Rook hides, one moves up to closer cover while another pins his cover. How many
    // move is per tier: at Relentless everyone who can, cover by cover (the coordinated push, 4.11).
    if (squad.playDue) startPlay(Math.round(squad.tier.playMovers));
    // Repositioning (decision 237): one stand-in that has used its spot enough moves on, if the squad allows it.
    const mover = activeEnemies.find((enemy) => enemy.wantsToReposition);
    if (mover) reposition(mover);
    glimpses.length = 0;
    for (const { enemy, world, view } of activeStandIns) {
      enemy.update(stepSec, player.position);
      view.update();
      glimpses.push(world.glimpse(enemy, stepSec));
    }
    exposure.update(stepSec, glimpses, player.stance.stance === 'crouching', camera.position);
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
    hud.update({ weapons, aimBlend: aim.eased, grenades: thrower.count, heals: heals.count, healing: heals.busy, camera });
    renderer.clear();
    renderer.render(scene, camera);
    renderer.clearDepth(); // the weapon is drawn over the world, so it never sinks into walls
    renderer.render(viewmodel.scene, viewmodel.camera);
  },
  () => game.isPlaying,
);
loop.start();
