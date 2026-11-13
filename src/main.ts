import * as THREE from 'three';
import { inputConfig } from './config/input';
import { Game } from './core/game';
import { Input } from './core/input';
import { Loop } from './core/loop';
import { uiText } from './data/uiText';
import { onFocusLost } from './platform/focus';
import { attachInputListeners } from './platform/inputListeners';
import { createPointerLock } from './platform/pointerLock';
import { createOverlay } from './ui/overlay';

// The cube and the mouse look below are stand-ins; milestone 1.2 replaces them with the real player.
const cubeSpinRadPerSec = 0.6;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.z = 3;

scene.add(new THREE.AmbientLight(0xffffff, 0.4));
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.position.set(3, 4, 5);
scene.add(sun);

const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x66aaff }));
scene.add(cube);

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

const mouseMove = { x: 0, y: 0 };
let yawRad = 0;
let pitchRad = 0;

const loop = new Loop(
  (stepSec) => {
    cube.rotation.x += cubeSpinRadPerSec * stepSec;
    cube.rotation.y += cubeSpinRadPerSec * stepSec;

    input.consumeMouseMove(mouseMove);
    yawRad -= mouseMove.x * inputConfig.mouseSensitivityRadPerPx;
    pitchRad -= mouseMove.y * inputConfig.mouseSensitivityRadPerPx;
    pitchRad = Math.max(-inputConfig.pitchLimitRad, Math.min(inputConfig.pitchLimitRad, pitchRad));
    camera.rotation.set(pitchRad, yawRad, 0, 'YXZ');
  },
  () => renderer.render(scene, camera),
  () => game.isPlaying,
);
loop.start();
