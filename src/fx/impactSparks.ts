import * as THREE from 'three';
import { rifleConfig } from '../config/rifle';
import type { EventBus } from '../core/events';
import type { WeaponEvents } from '../weapons/events';

const burstCount = 16; // the oldest burst is reused; a spray needs a handful at once
const sparksPerBurst = 8;
const sparkColour = 0xffd9a0;
const gravityMps2 = 9.8;
const spreadShare = 0.8; // how far sideways from the surface's normal a spark may fly, as a share of its speed

interface Burst {
  points: THREE.Points;
  material: THREE.PointsMaterial;
  velocities: Float32Array;
  ageSec: number;
  active: boolean;
}

// A few bright sparks that fly off a surface where any bullet hits it (Rook's or an enemy's), fall and fade. Part of the
// near-miss feedback (enemies.md, 4.5). Pooled in a ring: nothing is created while shooting. Cosmetic only.
export class ImpactSparks {
  private readonly bursts: Burst[] = [];
  private next = 0;

  constructor(scene: THREE.Scene, events: EventBus<WeaponEvents>) {
    for (let i = 0; i < burstCount; i++) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(sparksPerBurst * 3), 3));
      const material = new THREE.PointsMaterial({ color: sparkColour, size: rifleConfig.sparkSizeM, transparent: true, depthWrite: false });
      const points = new THREE.Points(geometry, material);
      points.visible = false;
      points.frustumCulled = false; // its points move, so the bounds would be stale
      scene.add(points);
      this.bursts.push({ points, material, velocities: new Float32Array(sparksPerBurst * 3), ageSec: 0, active: false });
    }
    events.on('shot:landed', ({ hit, end, normal }) => {
      if (hit) this.spawn(end, normal);
    });
  }

  /** Removes every spark (instant restart). */
  clear(): void {
    for (const burst of this.bursts) {
      burst.active = false;
      burst.points.visible = false;
    }
  }

  private spawn(at: THREE.Vector3, normal: THREE.Vector3): void {
    const burst = this.bursts[this.next];
    this.next = (this.next + 1) % burstCount;
    const position = burst.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < sparksPerBurst; i++) {
      position.setXYZ(i, at.x, at.y, at.z);
      // Mostly out along the normal, scattered sideways, each at its own speed.
      const speedMps = rifleConfig.sparkSpeedMps * (0.5 + Math.random() * 0.5);
      burst.velocities[i * 3] = (normal.x + (Math.random() * 2 - 1) * spreadShare) * speedMps;
      burst.velocities[i * 3 + 1] = (normal.y + (Math.random() * 2 - 1) * spreadShare) * speedMps;
      burst.velocities[i * 3 + 2] = (normal.z + (Math.random() * 2 - 1) * spreadShare) * speedMps;
    }
    position.needsUpdate = true;
    burst.material.size = rifleConfig.sparkSizeM;
    burst.material.opacity = 1;
    burst.ageSec = 0;
    burst.active = true;
    burst.points.visible = true;
  }

  update(dtSec: number): void {
    for (const burst of this.bursts) {
      if (!burst.active) continue;
      burst.ageSec += dtSec;
      const lifeSec = Math.max(rifleConfig.sparkLifeSec, 1e-3);
      if (burst.ageSec >= lifeSec) {
        burst.active = false;
        burst.points.visible = false;
        continue;
      }
      const position = burst.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      const v = burst.velocities;
      for (let i = 0; i < sparksPerBurst; i++) {
        v[i * 3 + 1] -= gravityMps2 * dtSec;
        position.setXYZ(i, position.getX(i) + v[i * 3] * dtSec, position.getY(i) + v[i * 3 + 1] * dtSec, position.getZ(i) + v[i * 3 + 2] * dtSec);
      }
      position.needsUpdate = true;
      burst.material.opacity = 1 - burst.ageSec / lifeSec;
    }
  }
}
