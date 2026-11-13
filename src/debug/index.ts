import * as THREE from 'three';
import GUI from 'lil-gui';
import { inputConfig, inputConfigDefaults } from '../config/input';
import { playerConfig, playerConfigDefaults } from '../config/player';
import { casingConfig, casingConfigDefaults } from '../config/casing';
import { dummyConfig, dummyConfigDefaults } from '../config/dummy';
import { knifeConfig, knifeConfigDefaults } from '../config/knife';
import { pistolConfig, pistolConfigDefaults } from '../config/pistol';
import { rifleConfig, rifleConfigDefaults } from '../config/rifle';
import type { Input } from '../core/input';
import type { Player } from '../player/player';
import type { PlayerHealth } from '../player/playerHealth';
import { healthConfig, healthConfigDefaults } from '../config/health';
import type { Viewmodel } from '../weapons/viewmodel/viewmodel';
import type { WeaponSet } from '../weapons/weaponSet';
import type { AudioSystem } from '../audio/audioSystem';
import { grenadeConfig, grenadeConfigDefaults } from '../config/grenade';
import { noiseConfig, noiseConfigDefaults } from '../config/noise';
import type { GrenadeThrower } from '../weapons/grenade/thrower';
import { soundNames } from '../audio/recipes';
import { audioConfig, audioConfigDefaults } from '../config/audio';
import { viewmodelConfig, viewmodelConfigDefaults } from '../config/viewmodel';
import { FreeCamera } from './freeCamera';
import { healthFolder, audioFolder, casingFolder, grenadeFolder, noiseFolder, changedValues, dummyFolder, viewmodelFolders, inputFolder, knifeFolder, pistolFolders, playerFolders, resetToDefaults, rifleFolders, toCodeSnippet } from './tuning';

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
  viewmodel: Viewmodel;
  weapons: WeaponSet;
  audio: AudioSystem;
  thrower: GrenadeThrower;
  health: PlayerHealth;
}

const maxFrameSec = 0.1; // a long pause must not fling the free camera across the room
const readoutIntervalSec = 0.1;
const markerColour = 0x33ff66;
const eyeDotColour = 0xff4444;
const eyeDotRadiusM = 0.05;
const capsuleSegments = 12;
const freeCameraKey = 'Backquote';

export function installDebugTools({ scene, input, player, viewmodel, weapons, audio, thrower, health }: Parts): DebugTools {
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

  const readouts = { health: '', position: '', speed: '', state: '', weapon: '', freeCamera: 'off (press ` to toggle)', status: '' };
  const readoutFolder = gui.addFolder('Readouts');
  for (const key of ['health', 'position', 'speed', 'state', 'weapon', 'freeCamera', 'status'] as const) {
    readoutFolder.add(readouts, key).listen().disable();
  }
  readoutFolder.open();

  const actions = {
    resetAll: () => {
      resetToDefaults(playerConfig, playerConfigDefaults);
      resetToDefaults(inputConfig, inputConfigDefaults);
      resetToDefaults(rifleConfig, rifleConfigDefaults);
      resetToDefaults(dummyConfig, dummyConfigDefaults);
      resetToDefaults(pistolConfig, pistolConfigDefaults);
      resetToDefaults(knifeConfig, knifeConfigDefaults);
      resetToDefaults(viewmodelConfig, viewmodelConfigDefaults);
      resetToDefaults(casingConfig, casingConfigDefaults);
      resetToDefaults(audioConfig, audioConfigDefaults);
      resetToDefaults(grenadeConfig, grenadeConfigDefaults);
      resetToDefaults(noiseConfig, noiseConfigDefaults);
      resetToDefaults(healthConfig, healthConfigDefaults);
      gui.controllersRecursive().forEach((controller) => controller.updateDisplay());
      readouts.status = 'All values reset';
    },
    copyAsCode: () => {
      const snippet = toCodeSnippet(
        changedValues(playerConfig, playerConfigDefaults),
        changedValues(inputConfig, inputConfigDefaults),
        changedValues(rifleConfig, rifleConfigDefaults),
        changedValues(dummyConfig, dummyConfigDefaults),
        {
          'src/config/pistol.ts': changedValues(pistolConfig, pistolConfigDefaults),
          'src/config/knife.ts': changedValues(knifeConfig, knifeConfigDefaults),
          'src/config/viewmodel.ts': changedValues(viewmodelConfig, viewmodelConfigDefaults),
          'src/config/casing.ts': changedValues(casingConfig, casingConfigDefaults),
          'src/config/audio.ts': changedValues(audioConfig, audioConfigDefaults),
          'src/config/grenade.ts': changedValues(grenadeConfig, grenadeConfigDefaults),
          'src/config/noise.ts': changedValues(noiseConfig, noiseConfigDefaults),
          'src/config/health.ts': changedValues(healthConfig, healthConfigDefaults),
        },
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

  for (const folder of pistolFolders) {
    const f = gui.addFolder(folder.title);
    f.close();
    for (const s of folder.sliders) f.add(pistolConfig, s.key, s.min, s.max, s.step).name(s.label);
  }
  const knifePanel = gui.addFolder(knifeFolder.title);
  knifePanel.close();
  for (const s of knifeFolder.sliders) knifePanel.add(knifeConfig, s.key, s.min, s.max, s.step).name(s.label);

  // Weapon animation: play each one on demand, slow it down to judge it, and tune its numbers.
  const animationFolder = gui.addFolder('Weapon animation');
  animationFolder.close();
  const previewSec = { reload: 1.8, draw: 0.4, check: 1.0 };
  animationFolder.add(viewmodelConfig, 'slowMotionScale', 0.05, 1, 0.05).name('Slow motion (kicks and previews)');
  animationFolder.add(previewSec, 'reload', 0.5, 5, 0.1).name('Preview reload time (s)');
  animationFolder.add(previewSec, 'draw', 0.1, 2, 0.05).name('Preview draw time (s)');
  animationFolder.add(previewSec, 'check', 0.3, 3, 0.05).name('Preview check time (s)');
  animationFolder.add({ play: () => viewmodel.preview('draw', previewSec.draw) }, 'play').name('Play: draw');
  animationFolder.add({ play: () => viewmodel.preview('fire', 0) }, 'play').name('Play: fire');
  animationFolder.add({ play: () => viewmodel.preview('reload', previewSec.reload) }, 'play').name('Play: reload');
  animationFolder.add({ play: () => viewmodel.preview('emptyReload', previewSec.reload + 0.4) }, 'play').name('Play: empty reload (with rack)');
  animationFolder.add({ play: () => viewmodel.preview('check', previewSec.check) }, 'play').name('Play: check magazine');
  animationFolder.add({ play: () => viewmodel.preview('inspect', 0) }, 'play').name('Play: inspect');
  const casingPanel = animationFolder.addFolder(casingFolder.title);
  casingPanel.close();
  for (const s of casingFolder.sliders) casingPanel.add(casingConfig, s.key, s.min, s.max, s.step).name(s.label);
  for (const folder of viewmodelFolders) {
    const f = animationFolder.addFolder(folder.title);
    f.close();
    for (const s of folder.sliders) f.add(viewmodelConfig, s.key, s.min, s.max, s.step).name(s.label);
  }

  const dummyPanel = gui.addFolder(dummyFolder.title);
  dummyPanel.close();
  for (const s of dummyFolder.sliders) dummyPanel.add(dummyConfig, s.key, s.min, s.max, s.step).name(s.label);

  const grenadePanel = gui.addFolder(grenadeFolder.title);
  grenadePanel.close();
  for (const s of grenadeFolder.sliders) grenadePanel.add(grenadeConfig, s.key, s.min, s.max, s.step).name(s.label);

  const healthPanel = gui.addFolder(healthFolder.title);
  healthPanel.close();
  for (const s of healthFolder.sliders) healthPanel.add(healthConfig, s.key, s.min, s.max, s.step).name(s.label);

  const noisePanel = gui.addFolder(noiseFolder.title);
  noisePanel.close();
  for (const s of noiseFolder.sliders) noisePanel.add(noiseConfig, s.key, s.min, s.max, s.step).name(s.label);

  // Sound: volumes, and a button for every sound so each can be heard on its own (works while paused).
  const audioPanel = gui.addFolder('Audio');
  audioPanel.close();
  for (const s of audioFolder.sliders) audioPanel.add(audioConfig, s.key, s.min, s.max, s.step).name(s.label);
  const soundButtons = audioPanel.addFolder('Play a sound');
  soundButtons.close();
  for (const name of soundNames) soundButtons.add({ play: () => audio.preview(name) }, 'play').name(name);

  // Testing aids that change the rules on purpose. Dev server only.
  const cheats = { infiniteAmmo: false };
  const cheatFolder = gui.addFolder('Testing aids');
  cheatFolder.add({ give: () => thrower.give(grenadeConfig.carryLimit) }, 'give').name('Give grenades (to the limit)');
  const hurtAmountHealth = 25;
  cheatFolder.add({ hurt: () => health.damage(hurtAmountHealth, 'debug') }, 'hurt').name('Hurt 25');
  cheatFolder.add({ kill: () => health.damage(Infinity, 'debug') }, 'kill').name('Kill');
  cheatFolder.add({ heal: () => health.reset() }, 'heal').name('Heal full (not when dead)');
  cheatFolder.add(health, 'invulnerable').name('Invulnerable');
  cheatFolder.add(cheats, 'infiniteAmmo').name('Infinite ammo').onChange((on: boolean) => weapons.setInfiniteAmmo(on));

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
    readouts.health = health.dead ? 'DEAD' : `${health.current.toFixed(0)}${health.invulnerable ? ' (invulnerable)' : ''}`;
    const p = player.position;
    readouts.position = `${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}`;
    readouts.speed = `${player.speedMps.toFixed(2)} m/s`;
    const flags = [player.stance.stance, player.grounded ? 'grounded' : 'in the air'];
    if (player.mantle.active) flags.push('climbing');
    if (player.isSprinting) flags.push('sprinting');
    if (player.slowed) flags.push('slowed by a fall');
    readouts.state = flags.join(', ');
    const gun = weapons.gun;
    readouts.weapon = gun ? `heat ${gun.heat.toFixed(0)}, jam chance ${(gun.jamChanceNow * 100).toFixed(1)}% per shot${gun.jammed ? ', JAMMED' : ''}` : weapons.current;
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
