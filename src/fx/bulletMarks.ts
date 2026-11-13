import * as THREE from 'three';
import { rifleConfig } from '../config/rifle';
import type { EventBus } from '../core/events';
import type { WeaponEvents } from '../weapons/events';

const maxMarks = 64; // the oldest is reused when they run out
const liftM = 0.01; // sits just off the surface so it does not flicker against it
const markColour = 0x050505;
const markSides = 8;
const forward = new THREE.Vector3(0, 0, 1);

// Dark spots where bullets hit. Pooled in a ring: the 65th shot reuses the 1st mark.
export class BulletMarks {
  private readonly marks: THREE.Mesh[] = [];
  private next = 0;
  private readonly turn = new THREE.Quaternion();

  constructor(scene: THREE.Scene, events: EventBus<WeaponEvents>) {
    // One unit-sized disc, scaled to the radius in the config each time, so the panel can change it live.
    const geometry = new THREE.CircleGeometry(1, markSides);
    const material = new THREE.MeshBasicMaterial({
      color: markColour,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    for (let i = 0; i < maxMarks; i++) {
      const mark = new THREE.Mesh(geometry, material);
      mark.visible = false;
      scene.add(mark);
      this.marks.push(mark);
    }
    events.on('shot:landed', (shot) => {
      if (shot.hit) this.place(shot.end, shot.normal);
    });
  }

  /** Removes every mark (instant restart). */
  clear(): void {
    for (const mark of this.marks) mark.visible = false;
    this.next = 0;
  }

  private place(point: THREE.Vector3, normal: THREE.Vector3): void {
    const mark = this.marks[this.next];
    this.next = (this.next + 1) % maxMarks;
    mark.position.copy(normal).multiplyScalar(liftM).add(point);
    mark.quaternion.setFromUnitVectors(forward, normal);
    // A random spin around the normal so the spots do not all look the same.
    mark.quaternion.multiply(this.turn.setFromAxisAngle(forward, Math.random() * Math.PI * 2));
    mark.scale.setScalar(rifleConfig.markRadiusM);
    mark.visible = true;
  }
}
