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
import { BulletMarks } from './fx/bulletMarks';
import { Tracers } from './fx/tracers';
import { addPlaceholderGun } from './weapons/placeholderGun';
import { Rifle } from './weapons/rifle';
import { Shooter } from './weapons/shooter';
import type { WeaponEvents } from './weapons/events';

const fireButton = 0; // left mouse

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

// Weapons. The rifle decides when a shot happens; the shooter finds where it lands; the effects listen.
const weaponEvents = new EventBus<WeaponEvents>();
scene.add(camera); // the placeholder gun is a child of the camera, so the camera must be in the scene
const rifle = new Rifle(weaponEvents);
const shooter = new Shooter(weaponEvents, level.collision, camera, addPlaceholderGun(camera));
const tracers = new Tracers(scene, weaponEvents);
new BulletMarks(scene, weaponEvents);
const weaponReadout = createWeaponReadout(); // made before the overlay so the overlay covers it

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
    rifle.update(stepSec, {
      triggerHeld: input.isButtonDown(fireButton),
      reloadPressed: input.consumePress('KeyR'),
      canFire: !player.isSprinting && !player.mantle.active,
    });
    shooter.recoil.update(stepSec);
    tracers.update(stepSec);
    weaponReadout.update(rifle);
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
