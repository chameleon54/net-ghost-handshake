import * as THREE from 'three';
import { viewConfig } from '../../config/view';
import type { EventBus } from '../../core/events';
import type { GunId, WeaponEvents, WeaponId } from '../events';
import { ViewmodelAnimator, type AnimatorInput, type PreviewKind } from './animator';
import { buildModels } from './models';

const nearM = 0.01;
const farM = 5;
const lightColours = { sky: 0xffffff, ground: 0x444a50 } as const;
const lightStrength = { sky: 1.5, sun: 1.8 } as const;
const sunPositionM = { x: 1, y: 2, z: 1.5 };

// The weapon in front of the player. It lives in its own scene, drawn after the world with the depth cleared and its own
// camera at a fixed field of view, so it never sinks into walls and does not grow when the view zooms in to aim.
// Positions here are therefore camera space: the camera sits at the origin looking down -z.
export class Viewmodel {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(viewConfig.viewmodelFovDeg, 1, nearM, farM);
  /** Each gun's muzzle in camera space, kept up to date every frame, for the tracers. */
  readonly muzzles: Record<GunId, THREE.Vector3> = { rifle: new THREE.Vector3(), pistol: new THREE.Vector3() };
  /** Each gun's ejection port in camera space, kept up to date every frame, for the casings. */
  readonly ejectionPorts: Record<GunId, THREE.Vector3> = { rifle: new THREE.Vector3(), pistol: new THREE.Vector3() };

  private readonly models = buildModels();
  private readonly animator = new ViewmodelAnimator();

  constructor(events: EventBus<WeaponEvents>) {
    this.scene.add(new THREE.HemisphereLight(lightColours.sky, lightColours.ground, lightStrength.sky));
    const sun = new THREE.DirectionalLight(0xffffff, lightStrength.sun);
    sun.position.set(sunPositionM.x, sunPositionM.y, sunPositionM.z);
    this.scene.add(sun);
    for (const model of Object.values(this.models)) {
      model.root.visible = false;
      this.scene.add(model.root);
    }
    events.on('weapon:fired', ({ weapon }) => this.animator.fired(weapon));
    events.on('weapon:swing', () => this.animator.swung());
    events.on('weapon:rack', () => this.animator.racked());
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Hold F: inspect the weapon. Ignored if something else is going on. */
  inspect(): void {
    this.animator.inspect();
  }

  /** Dev panel: play one animation on its own. `durationSec` is how long a draw, reload or check preview takes. */
  preview(kind: PreviewKind, durationSec: number): void {
    this.animator.playPreview(kind, durationSec);
  }

  /** Once per screen frame. `input.aimBlend` is 0 at the hip and 1 fully aimed. */
  update(dtSec: number, input: AnimatorInput): void {
    const aimBlend = input.aimBlend ?? 0;
    this.animator.update(dtSec, input);
    const pose = this.animator.pose;

    for (const [id, model] of Object.entries(this.models) as [WeaponId, (typeof this.models)[WeaponId]][]) {
      model.root.visible = id === input.weapon;
    }
    const model = this.models[input.weapon];
    const { rest, aimed, base } = model;

    model.root.position.set(
      rest.x + (aimed.x - rest.x) * aimBlend + pose.x,
      rest.y + (aimed.y - rest.y) * aimBlend + pose.y,
      rest.z + (aimed.z - rest.z) * aimBlend + pose.z,
    );
    model.root.rotation.set(rest.pitchRad + pose.pitchRad, rest.yawRad + pose.yawRad, rest.rollRad + pose.rollRad, 'YXZ');

    if (model.mag) {
      model.mag.position.y = base.magY + pose.magY;
      model.mag.visible = pose.magVisible;
    }
    if (model.slide) model.slide.position.z = base.slideZ + pose.slideZ;
    if (model.stuckCasing) model.stuckCasing.visible = pose.stuckCasing;
    if (model.handOff) model.handOff.position.set(base.handOff.x + pose.handX, base.handOff.y + pose.handY, base.handOff.z + pose.handZ);

    // Tracers start where the muzzle really is this frame, and casings where the ejection port is.
    if (model.muzzle && model.ejection && (input.weapon === 'rifle' || input.weapon === 'pistol')) {
      this.scene.updateMatrixWorld();
      model.muzzle.getWorldPosition(this.muzzles[input.weapon]);
      model.ejection.getWorldPosition(this.ejectionPorts[input.weapon]);
    }
  }
}
