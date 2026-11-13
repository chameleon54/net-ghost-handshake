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
import { rifleConfig } from './config/rifle';
import type { WeaponEvents, WeaponId } from './weapons/events';
import { Gun } from './weapons/gun';
import { Knife } from './weapons/knife';
import { KnifeStrike } from './weapons/knifeStrike';
import { PlaceholderViewmodels } from './weapons/placeholderGun';
import { Shooter } from './weapons/shooter';
import { WeaponSet } from './weapons/weaponSet';

const fireButton = 0; // left mouse
const weaponKeys: Record<string, WeaponId> = { Digit1: 'rifle', Digit2: 'pistol', Digit3: 'knife' };

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101418);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 100);

scene.add(new THREE.HemisphereLight(0xffffff, 0x333a40, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(4, 8, 3);
scene.add(sun);

const level = buildGreybox();
scene.add(level.group);
const player = new Player(level.collision);

// Weapons. A gun decides when a shot happens; the shooter finds where it lands; the effects listen.
const weaponEvents = new EventBus<WeaponEvents>();
scene.add(camera); // the placeholder weapons are children of the camera, so the camera must be in the scene
const weapons = new WeaponSet(
  weaponEvents,
  new Gun(weaponEvents, 'rifle', rifleConfig, true),
  new Gun(weaponEvents, 'pistol', pistolConfig, false),
  new Knife(weaponEvents),
);
const viewmodels = new PlaceholderViewmodels(camera);
weaponEvents.on('weapon:switched', ({ weapon }) => viewmodels.show(weapon));
weaponEvents.on('weapon:swing', () => viewmodels.jab());
const dummies = greyboxDummies.map(({ xM, zM, yawRad }) => new Dummy(xM, zM, yawRad));
const dummyViews = dummies.map((dummy) => new DummyView(dummy));
for (const view of dummyViews) scene.add(view.group);
const shooter = new Shooter(weaponEvents, level.collision, camera, viewmodels.muzzles, dummies, { rifle: rifleConfig, pistol: pistolConfig });
new KnifeStrike(weaponEvents, level.collision, camera, dummies);
const tracers = new Tracers(scene, weaponEvents);
new BulletMarks(scene, weaponEvents);
const weaponReadout = createWeaponReadout(weaponEvents); // made before the overlay so the overlay covers it

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
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

const overlay = createOverlay(() => void pointerLock.request());
overlay.show(uiText.clickToPlay);
game.events.on('game:playing', () => overlay.hide());
game.events.on('game:paused', () => overlay.show(uiText.paused));
game.events.on('game:capture-refused', () => overlay.show(uiText.captureRefused));

// Debug tools (tuning panel, free camera) exist only on the dev server. Vite removes this block from the production
// build, so neither the tools nor lil-gui are shipped to players.
let debug: DebugTools | null = null;
if (import.meta.env.DEV) {
  void import('./debug').then((tools) => {
    debug = tools.installDebugTools({ scene, input, player });
  });
}

const loop = new Loop(
  (stepSec) => {
    if (debug?.freeCameraActive) return; // the player is frozen while the free camera flies
    player.fixedUpdate(stepSec, input);
    // Every press is consumed each update, so a click that could not be used is not remembered for later.
    let select: WeaponId | null = null;
    for (const [code, weapon] of Object.entries(weaponKeys)) if (input.consumePress(code)) select = weapon;
    weapons.update(stepSec, {
      select,
      wheelSteps: input.consumeWheelSteps(),
      triggerHeld: input.isButtonDown(fireButton),
      triggerPressed: input.consumeButtonPress(fireButton),
      reloadPressed: input.consumePress('KeyR'),
      canFire: !player.isSprinting && !player.mantle.active,
    });
    viewmodels.update(stepSec);
    shooter.recoil.update(stepSec);
    tracers.update(stepSec);
    dummies.forEach((dummy, i) => {
      dummy.update(stepSec);
      dummyViews[i].update();
    });
    weaponReadout.update(weapons);
  },
  (alpha) => {
    // The free camera, when on, places the camera itself; otherwise the player does.
    if (!debug?.beforeRender(camera)) {
      player.look(input);
      player.applyToCamera(camera, alpha, shooter.recoil.pitchRad, shooter.recoil.yawRad);
    }
    renderer.render(scene, camera);
  },
  () => game.isPlaying,
);
loop.start();
