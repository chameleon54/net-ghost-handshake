import * as THREE from 'three';
import { Game } from './core/game';
import { Input } from './core/input';
import { Loop } from './core/loop';
import { uiText } from './data/uiText';
import type { DebugTools } from './debug';
import { buildGreybox } from './level/greybox';
import { onFocusLost } from './platform/focus';
import { attachInputListeners } from './platform/inputListeners';
import { createPointerLock } from './platform/pointerLock';
import { Player } from './player/player';
import { createOverlay } from './ui/overlay';
import { createWeaponReadout } from './ui/weaponReadout';
import { EventBus } from './core/events';
import { greyboxDummies } from './data/greyboxDummies';
import { Dummy } from './enemies/dummy';
import { DummyView } from './enemies/dummyView';
import { BulletMarks } from './fx/bulletMarks';
import { Tracers } from './fx/tracers';
import { pistolConfig } from './config/pistol';
import { viewConfig } from './config/view';
import { grenadeConfig } from './config/grenade';
import { inputConfig } from './config/input';
import { BarrelSmoke } from './fx/barrelSmoke';
import { AudioSystem } from './audio/audioSystem';
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

const level = buildGreybox();
scene.add(level.group);
const player = new Player(level.collision);

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
const dummies = greyboxDummies.map(({ xM, zM, yawRad }) => new Dummy(xM, zM, yawRad));
const dummyViews = dummies.map((dummy) => new DummyView(dummy));
for (const view of dummyViews) scene.add(view.group);
const shooter = new Shooter(weaponEvents, level.collision, camera, viewmodel.muzzles, dummies, gunConfigs);
new KnifeStrike(weaponEvents, level.collision, camera, dummies);
const tracers = new Tracers(scene, weaponEvents);
const barrelSmoke = new BarrelSmoke(scene, camera, viewmodel.muzzles.rifle);
// Sound: the audio system starts from the Play click (browser rule); the weapon sounds listen to the weapon events.
const audio = new AudioSystem(scene, camera);
const weaponSounds = new WeaponSounds(weaponEvents, audio);
new NoiseReporter(weaponEvents, () => camera.position); // what the player does that enemies could hear (they listen from 4.10)
const casings = new Casings(scene, weaponEvents, level.collision, camera, viewmodel.ejectionPorts);
// R: a tap reloads, a hold checks the magazine. F: a hold inspects the weapon.
const reloadKey = new HoldTap();
const inspectKey = new HoldTap();
new BulletMarks(scene, weaponEvents);
// Grenades: G throws one (the thrower holds the rules), the system flies it and works out the blast, and the effects listen.
const thrower = new GrenadeThrower(weaponEvents);
const blastTargets = dummies.map((dummy) => dummyBlastTarget(dummy, weaponEvents));
const playerBlastTarget = {
  chest: (out: THREE.Vector3) => out.set(player.position.x, player.position.y + grenadeConfig.targetChestHeightM, player.position.z),
  vulnerable: () => true,
  hurt: () => {}, // the player has no health until milestone 3.1; the system publishes `player:blast` with the damage
};
const grenades = new GrenadeSystem(scene, weaponEvents, level.collision, camera, blastTargets, playerBlastTarget);
const explosions = new Explosions(scene, weaponEvents, level.collision);
const cameraShake = new CameraShake(weaponEvents, () => camera.position);
const weaponReadout = createWeaponReadout(weaponEvents); // made before the overlay so the overlay covers it

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
overlay.show(uiText.clickToPlay);
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
    debug = tools.installDebugTools({ scene, input, player, viewmodel, weapons, audio, thrower });
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
    // Aiming is allowed with a gun out that is not being drawn, and not while sprinting, climbing or vaulting.
    // Reloading does not stop it (owner's choice).
    const gunInHand = weapons.gun;
    const canAim = gunInHand !== null && !weapons.drawing && !thrower.busy && !player.isSprinting && !player.mantle.active;
    aim.update(stepSec, canAim && input.isButtonDown(aimButton), gunInHand ? gunConfigs[gunInHand.id] : null);
    player.speedScale = aim.moveSpeedScale;
    shooter.aimBlend = aim.eased;

    player.fixedUpdate(stepSec, input);
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
      canThrow: !player.isSprinting && !player.mantle.active && !gunBusy,
    });
    if (thrower.justFinished) weapons.redraw(); // the weapon comes back up after the throw
    // While the hands are busy with the grenade nothing else can be done with the weapons.
    const handsFree = !thrower.busy;
    if (!handsFree) select = null;
    const wheelSteps = input.consumeWheelSteps();
    weapons.update(stepSec, {
      select,
      wheelSteps: handsFree ? wheelSteps : 0,
      triggerHeld: handsFree && input.isButtonDown(fireButton),
      triggerPressed: input.consumeButtonPress(fireButton) && handsFree,
      reloadPressed: reloadKey.tapped && handsFree,
      checkRequested: reloadKey.holdStarted && handsFree,
      canFire: handsFree && !player.isSprinting && !player.mantle.active,
    });
    if (inspectKey.holdStarted && canInspect()) {
      viewmodel.inspect();
      const length = weapons.current === 'knife' ? viewmodelConfig.inspectKnifeSec : viewmodelConfig.inspectGunSec;
      weaponEvents.emit('weapon:inspect-started', { weapon: weapons.current, durationSec: length });
    }
    shooter.recoil.update(stepSec);
    tracers.update(stepSec);
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
    weaponReadout.update(weapons, aim.eased, thrower.count);
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
    renderer.clear();
    renderer.render(scene, camera);
    renderer.clearDepth(); // the weapon is drawn over the world, so it never sinks into walls
    renderer.render(viewmodel.scene, viewmodel.camera);
  },
  () => game.isPlaying,
);
loop.start();
