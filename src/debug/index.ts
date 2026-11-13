import * as THREE from 'three';
import GUI from 'lil-gui';
import { inputConfig, inputConfigDefaults } from '../config/input';
import { playerConfig, playerConfigDefaults } from '../config/player';
import { dummyConfig, dummyConfigDefaults } from '../config/dummy';
import { rifleConfig, rifleConfigDefaults } from '../config/rifle';
import type { Input } from '../core/input';
import type { Player } from '../player/player';
import { FreeCamera } from './freeCamera';
import { changedValues, dummyFolder, inputFolder, playerFolders, resetToDefaults, rifleFolders, toCodeSnippet } from './tuning';

// Developer tools: the tuning panel and the free camera. Loaded only by the dev server (see src/main.ts),
// so none of this, including lil-gui, is in the game players get.

export interface DebugTools {
  /** True while the free camera has taken over the view. */
  readonly freeCameraActive: boolean;
  /** Call once per screen frame before drawing. Returns true if the free camera placed the camera this frame. */
  beforeRender(camera: THREE.PerspectiveCamera): boolean;
}

interface Parts {
  scene: THREE.Scene;
  input: Input;
  player: Player;
}

const maxFrameSec = 0.1; // a long pause must not fling the free camera across the room
const readoutIntervalSec = 0.1;
const markerColour = 0x33ff66;
const eyeDotColour = 0xff4444;
const eyeDotRadiusM = 0.05;
const capsuleSegments = 12;
const freeCameraKey = 'Backquote';

export function installDebugTools({ scene, input, player }: Parts): DebugTools {
  const freeCamera = new FreeCamera();
  let lastFrameMs = performance.now();
  let readoutTimerSec = 0;

  // ---- The capsule marker: shows where the player is and how tall, while the free camera is on.
  const marker = new THREE.Group();
  const eyeDot = new THREE.Mesh(new THREE.SphereGeometry(eyeDotRadiusM), new THREE.MeshBasicMaterial({ color: eyeDotColour }));
  marker.add(eyeDot);
  marker.visible = false;
  scene.add(marker);
  let capsule: THREE.Mesh | null = null;
  let capsuleBuiltFor = { heightM: -1, radiusM: -1 };

  function updateMarker(): void {
    const heightM = player.capsuleHeightM;
    const radiusM = playerConfig.capsuleRadiusM;
    if (!capsule || capsuleBuiltFor.heightM !== heightM || capsuleBuiltFor.radiusM !== radiusM) {
      if (capsule) {
        marker.remove(capsule);
        capsule.geometry.dispose();
      }
      // CapsuleGeometry takes the straight middle part; the two rounded ends add one radius each.
      const geometry = new THREE.CapsuleGeometry(radiusM, Math.max(heightM - 2 * radiusM, 0), capsuleSegments, capsuleSegments * 2);
      capsule = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: markerColour, wireframe: true }));
      marker.add(capsule);
      capsuleBuiltFor = { heightM, radiusM };
    }
    // The feet position is the player's position; the capsule is centred half its height above it.
    capsule.position.set(player.position.x, player.position.y + heightM / 2, player.position.z);
    eyeDot.position.set(player.position.x, player.position.y + player.eyeHeightNowM, player.position.z);
  }

  // ---- The tuning panel.
  const gui = new GUI({ title: 'Tuning (dev only, Esc to use)', width: 320 });
  gui.close();

  const readouts = { position: '', speed: '', state: '', freeCamera: 'off (press ` to toggle)', status: '' };
  const readoutFolder = gui.addFolder('Readouts');
  for (const key of ['position', 'speed', 'state', 'freeCamera', 'status'] as const) {
    readoutFolder.add(readouts, key).listen().disable();
  }
  readoutFolder.open();

  const actions = {
    resetAll: () => {
      resetToDefaults(playerConfig, playerConfigDefaults);
      resetToDefaults(inputConfig, inputConfigDefaults);
      resetToDefaults(rifleConfig, rifleConfigDefaults);
      resetToDefaults(dummyConfig, dummyConfigDefaults);
      gui.controllersRecursive().forEach((controller) => controller.updateDisplay());
      readouts.status = 'All values reset';
    },
    copyAsCode: () => {
      const snippet = toCodeSnippet(
        changedValues(playerConfig, playerConfigDefaults),
        changedValues(inputConfig, inputConfigDefaults),
        changedValues(rifleConfig, rifleConfigDefaults),
        changedValues(dummyConfig, dummyConfigDefaults),
      );
      navigator.clipboard.writeText(snippet).then(
        () => (readouts.status = 'Copied to the clipboard'),
        () => {
          readouts.status = 'Copy failed; the code is in the console';
          console.log(snippet);
        },
      );
    },
  };
  gui.add(actions, 'resetAll').name('Reset all values');
  gui.add(actions, 'copyAsCode').name('Copy changed values as code');

  for (const folder of playerFolders) {
    const f = gui.addFolder(folder.title);
    f.close();
    for (const s of folder.sliders) f.add(playerConfig, s.key, s.min, s.max, s.step).name(s.label);
  }
  const mouse = gui.addFolder(inputFolder.title);
  mouse.close();
  for (const s of inputFolder.sliders) mouse.add(inputConfig, s.key, s.min, s.max, s.step).name(s.label);

  for (const folder of rifleFolders) {
    const f = gui.addFolder(folder.title);
    f.close();
    for (const s of folder.sliders) f.add(rifleConfig, s.key, s.min, s.max, s.step).name(s.label);
  }

  const dummyPanel = gui.addFolder(dummyFolder.title);
  dummyPanel.close();
  for (const s of dummyFolder.sliders) dummyPanel.add(dummyConfig, s.key, s.min, s.max, s.step).name(s.label);

  const cameraFolder = gui.addFolder('Free camera');
  cameraFolder.close();
  cameraFolder.add(freeCamera, 'speedMps', 1, 30, 0.5).name('Speed (m/s)');
  cameraFolder.add(freeCamera, 'fastMultiplier', 1, 10, 0.5).name('Shift multiplier');

  function setFreeCamera(camera: THREE.PerspectiveCamera, on: boolean): void {
    if (on) freeCamera.enter(camera);
    else freeCamera.exit();
    marker.visible = on;
    readouts.freeCamera = on ? 'ON (W A S D, Space up, C down, Shift fast)' : 'off (press ` to toggle)';
  }

  function updateReadouts(dtSec: number): void {
    readoutTimerSec += dtSec;
    if (readoutTimerSec < readoutIntervalSec) return;
    readoutTimerSec = 0;
    const p = player.position;
    readouts.position = `${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}`;
    readouts.speed = `${player.speedMps.toFixed(2)} m/s`;
    const flags = [player.stance.stance, player.grounded ? 'grounded' : 'in the air'];
    if (player.mantle.active) flags.push('climbing');
    if (player.isSprinting) flags.push('sprinting');
    readouts.state = flags.join(', ');
  }

  return {
    get freeCameraActive() {
      return freeCamera.active;
    },
    beforeRender(camera) {
      const now = performance.now();
      const dtSec = Math.min((now - lastFrameMs) / 1000, maxFrameSec);
      lastFrameMs = now;

      if (input.consumePress(freeCameraKey)) setFreeCamera(camera, !freeCamera.active);
      updateReadouts(dtSec);
      if (!freeCamera.active) return false;
      updateMarker();
      freeCamera.update(dtSec, input, camera);
      return true;
    },
  };
}
