import * as THREE from 'three';
import { rifleConfig } from '../config/rifle';
import type { EventBus } from '../core/events';
import type { WeaponEvents } from '../weapons/events';

const poolSize = 24; // 700 rpm with 0.25 s streaks needs about 3; the rest is headroom
const tracerColour = 0xffd27a;

interface Tracer {
  line: THREE.Line;
  /** Where the streak flies, from the muzzle to the end point. */
  from: THREE.Vector3;
  to: THREE.Vector3;
  lengthM: number;
  ageSec: number;
  active: boolean;
}

// Short bright streaks that fly from the muzzle to where the bullet landed. The hit itself is instant;
// the streak is only for the eye. Pooled: nothing is created while shooting.
export class Tracers {
  private readonly pool: Tracer[] = [];
  private readonly head = new THREE.Vector3();
  private readonly tail = new THREE.Vector3();

  constructor(scene: THREE.Scene, events: EventBus<WeaponEvents>) {
    const material = new THREE.LineBasicMaterial({ color: tracerColour });
    for (let i = 0; i < poolSize; i++) {
      const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const line = new THREE.Line(geometry, material);
      line.visible = false;
      line.frustumCulled = false; // its points move, so the bounds would be stale
      scene.add(line);
      this.pool.push({ line, from: new THREE.Vector3(), to: new THREE.Vector3(), lengthM: 0, ageSec: 0, active: false });
    }
    events.on('shot:landed', (shot) => this.spawn(shot.muzzle, shot.end));
  }

  /** Removes every streak (instant restart). */
  clear(): void {
    for (const tracer of this.pool) {
      tracer.active = false;
      tracer.line.visible = false;
    }
  }

  private spawn(muzzle: THREE.Vector3, end: THREE.Vector3): void {
    // shortcut: if all are busy the shot gets no tracer; the pool is far bigger than a spray needs.
    const tracer = this.pool.find((t) => !t.active);
    if (!tracer) return;
    tracer.from.copy(muzzle);
    tracer.to.copy(end);
    tracer.lengthM = muzzle.distanceTo(end);
    tracer.ageSec = 0;
    tracer.active = true;
    tracer.line.visible = true;
  }

  update(dtSec: number): void {
    for (const tracer of this.pool) {
      if (!tracer.active) continue;
      tracer.ageSec += dtSec;
      const headM = tracer.ageSec * rifleConfig.tracerSpeedMps;
      const tailM = headM - rifleConfig.tracerLengthM;
      if (tailM >= tracer.lengthM) {
        tracer.active = false;
        tracer.line.visible = false;
        continue;
      }
      this.head.lerpVectors(tracer.from, tracer.to, Math.min(headM, tracer.lengthM) / tracer.lengthM || 0);
      this.tail.lerpVectors(tracer.from, tracer.to, Math.max(tailM, 0) / tracer.lengthM || 0);
      const position = tracer.line.geometry.getAttribute('position') as THREE.BufferAttribute;
      position.setXYZ(0, this.tail.x, this.tail.y, this.tail.z);
      position.setXYZ(1, this.head.x, this.head.y, this.head.z);
      position.needsUpdate = true;
    }
  }
}
