import * as THREE from 'three';
import { glassConfig } from '../config/glass';
import type { EventBus } from '../core/events';
import { toLocal, toWorld, yawRadOf } from '../level/boxShape';
import type { GlassPane } from '../level/glass';
import type { WeaponEvents } from '../weapons/events';

const gravityMps2 = 9.8;
const crackColour = 0xffffff;
const shardColour = 0x9fdcf2;
/** Shards start anywhere on the pane, but never higher than this above its bottom: a tall pane does not rain from the ceiling. */
const shardStartMaxHeightM = 2.5;
const sprayShare = 0.6; // how far sideways a shard may fly, as a share of its speed

interface Burst {
  points: THREE.Points;
  material: THREE.PointsMaterial;
  velocities: Float32Array;
  ageSec: number;
  active: boolean;
}

// What breaking glass looks like (5.4): a crack mark where each bullet went through, and, when a pane shatters, the pane
// disappears and a burst of shards flies off and falls. Cosmetic only: no physics, the shard bursts are pooled (the oldest
// is reused), and the crack marks are a few line segments per pane that go when it breaks.
export class GlassFx {
  private readonly cracks = new Map<string, THREE.LineSegments[]>();
  private readonly bursts: Burst[] = [];
  private next = 0;
  private readonly crackMaterial = new THREE.LineBasicMaterial({ color: crackColour, transparent: true, opacity: 0.9 });

  constructor(
    private readonly scene: THREE.Scene,
    events: EventBus<WeaponEvents>,
    private readonly paneMeshes: ReadonlyMap<string, THREE.Mesh>,
  ) {
    for (let i = 0; i < glassConfig.maxShardBursts; i++) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(glassConfig.shardsPerBurst * 3), 3));
      const material = new THREE.PointsMaterial({ color: shardColour, size: glassConfig.shardSizeM, transparent: true, depthWrite: false });
      const points = new THREE.Points(geometry, material);
      points.visible = false;
      points.frustumCulled = false; // its points move, so the bounds would be stale
      scene.add(points);
      this.bursts.push({ points, material, velocities: new Float32Array(glassConfig.shardsPerBurst * 3), ageSec: 0, active: false });
    }
    events.on('glass:cracked', ({ pane, position, hits }) => this.addCrack(pane, position, hits));
    events.on('glass:broken', ({ pane, direction }) => {
      this.removeCracks(pane.id);
      this.setPaneVisible(pane.id, false);
      this.spawnShards(pane, direction);
    });
  }

  /** Every pane drawn again, the cracks and shards gone (instant restart). */
  clear(): void {
    for (const id of [...this.cracks.keys()]) this.removeCracks(id);
    for (const mesh of this.paneMeshes.values()) mesh.visible = true;
    for (const burst of this.bursts) {
      burst.active = false;
      burst.points.visible = false;
    }
  }

  update(dtSec: number): void {
    for (const burst of this.bursts) {
      if (!burst.active) continue;
      burst.ageSec += dtSec;
      if (burst.ageSec >= glassConfig.shardLifeSec) {
        burst.active = false;
        burst.points.visible = false;
        continue;
      }
      const position = burst.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      const v = burst.velocities;
      for (let i = 0; i < glassConfig.shardsPerBurst; i++) {
        v[i * 3 + 1] -= gravityMps2 * dtSec;
        position.setXYZ(i, position.getX(i) + v[i * 3] * dtSec, Math.max(position.getY(i) + v[i * 3 + 1] * dtSec, 0), position.getZ(i) + v[i * 3 + 2] * dtSec);
      }
      position.needsUpdate = true;
      burst.material.opacity = 1 - burst.ageSec / glassConfig.shardLifeSec;
    }
  }

  private setPaneVisible(id: string, visible: boolean): void {
    const mesh = this.paneMeshes.get(id);
    if (mesh) mesh.visible = visible;
  }

  /** A star of kinked spokes in the pane's own plane, at the point the bullet went through; later hits make a bigger one. */
  private addCrack(pane: GlassPane, at: THREE.Vector3, hits: number): void {
    const stage = Math.min(hits, glassConfig.crackSpokes.length) - 1;
    const spokes = glassConfig.crackSpokes[stage];
    const radiusM = glassConfig.crackRadiusM[stage];
    const points = new Float32Array(spokes * 4 * 3); // each spoke: two segments, four end points
    const kink = (angle: number, lengthM: number, out: number): void => {
      points[out] = Math.cos(angle) * lengthM;
      points[out + 1] = Math.sin(angle) * lengthM;
    };
    for (let s = 0; s < spokes; s++) {
      const angle = ((s + Math.random() * 0.6) / spokes) * Math.PI * 2;
      const o = s * 12;
      const bend = angle + (Math.random() - 0.5) * 0.4;
      kink(angle, 0, o + 0);
      kink(bend, radiusM * 0.5, o + 3); // the spoke's kink is the end of its first segment and the start of its second
      kink(bend, radiusM * 0.5, o + 6);
      kink(angle + (Math.random() - 0.5) * 0.5, radiusM * (0.7 + Math.random() * 0.3), o + 9);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(points, 3));
    const mark = new THREE.LineSegments(geometry, this.crackMaterial);
    // The pane is thin along its smaller side; the mark lies in the plane through its middle (the pane is see-through), turned with it.
    const alongX = pane.box.depthM <= pane.box.widthM;
    const local = toLocal(pane.box, at.x, at.z);
    const onPlane = toWorld(pane.box, alongX ? local.x : 0, alongX ? 0 : local.z);
    mark.position.set(onPlane.x, at.y, onPlane.z);
    mark.rotation.y = yawRadOf(pane.box) + (alongX ? 0 : Math.PI / 2);
    this.scene.add(mark);
    this.cracks.set(pane.id, [...(this.cracks.get(pane.id) ?? []), mark]);
  }

  private removeCracks(id: string): void {
    for (const mark of this.cracks.get(id) ?? []) {
      this.scene.remove(mark);
      mark.geometry.dispose();
    }
    this.cracks.delete(id);
  }

  /** Shards from all over the pane, flung the way the bullet or blast was going, then falling. */
  private spawnShards(pane: GlassPane, direction: THREE.Vector3): void {
    const burst = this.bursts[this.next];
    this.next = (this.next + 1) % this.bursts.length;
    const { box } = pane;
    const bottomM = box.yM ?? 0;
    const position = burst.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < glassConfig.shardsPerBurst; i++) {
      const start = toWorld(box, (Math.random() - 0.5) * box.widthM, (Math.random() - 0.5) * box.depthM); // anywhere on the pane, turned with it
      position.setXYZ(i, start.x, bottomM + Math.random() * Math.min(box.heightM, shardStartMaxHeightM), start.z);
      const speedMps = glassConfig.shardSpeedMps * (0.4 + Math.random() * 0.6);
      burst.velocities[i * 3] = (direction.x + (Math.random() * 2 - 1) * sprayShare) * speedMps;
      burst.velocities[i * 3 + 1] = (direction.y + (Math.random() * 2 - 1) * sprayShare) * speedMps;
      burst.velocities[i * 3 + 2] = (direction.z + (Math.random() * 2 - 1) * sprayShare) * speedMps;
    }
    position.needsUpdate = true;
    burst.material.opacity = 1;
    burst.ageSec = 0;
    burst.active = true;
    burst.points.visible = true;
  }
}
