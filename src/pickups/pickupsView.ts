import * as THREE from 'three';
import { pickupConfig } from '../config/pickups';
import type { PickupKind } from '../weapons/events';
import type { Pickups } from './pickups';

// Placeholder look for dropped items (4.12): a grenade or a magazine lying on the floor, with a pulsing ring under it so
// it can be found in a fight. Meshes are made as needed and reused.
const grenadeRadiusM = 0.06;
const grenadeColour = 0x3d4a2c;
const magazineSizeM = { width: 0.04, height: 0.05, length: 0.16 } as const;
const pistolMagazineShare = 0.6; // a pistol magazine is shorter than a rifle's
const magazineColours: Record<Exclude<PickupKind, 'grenade'>, number> = { rifle: 0x2a2d31, pistol: 0x3a3f45 };
const ringInnerM = 0.16;
const ringOuterM = 0.22;
const ringColour = 0xfff2b0;
const ringLiftM = 0.01; // just above the floor, so it does not flicker against it
const ringOpacityMin = 0.2;
const ringOpacityMax = 0.8;

interface Look {
  group: THREE.Group;
  items: Record<PickupKind, THREE.Mesh>;
}

export class PickupsView {
  private readonly looks: Look[] = [];
  private readonly ringMaterial = new THREE.MeshBasicMaterial({ color: ringColour, transparent: true, side: THREE.DoubleSide, depthWrite: false });
  private clockSec = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly pickups: Pickups,
  ) {}

  /** Once per game update. */
  update(dtSec: number): void {
    this.clockSec += dtSec;
    const items = this.pickups.items;
    while (this.looks.length < items.length) this.looks.push(this.makeLook());
    const pulse = 0.5 + 0.5 * Math.sin((this.clockSec / Math.max(pickupConfig.glowPulseSec, 0.1)) * 2 * Math.PI);
    this.ringMaterial.opacity = ringOpacityMin + (ringOpacityMax - ringOpacityMin) * pulse;
    this.looks.forEach((look, i) => {
      const item = items[i];
      look.group.visible = item !== undefined;
      if (!item) return;
      look.group.position.set(item.xM, 0, item.zM);
      for (const [kind, mesh] of Object.entries(look.items)) mesh.visible = kind === item.kind;
    });
  }

  private makeLook(): Look {
    const group = new THREE.Group();
    const grenade = new THREE.Mesh(new THREE.SphereGeometry(grenadeRadiusM, 12, 8), new THREE.MeshStandardMaterial({ color: grenadeColour }));
    grenade.position.y = grenadeRadiusM;
    const magazine = (kind: 'rifle' | 'pistol') => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(magazineSizeM.width, magazineSizeM.height, kind === 'rifle' ? magazineSizeM.length : magazineSizeM.length * pistolMagazineShare),
        new THREE.MeshStandardMaterial({ color: magazineColours[kind] }),
      );
      mesh.position.y = magazineSizeM.height / 2;
      return mesh;
    };
    const items = { grenade, rifle: magazine('rifle'), pistol: magazine('pistol') };
    const ring = new THREE.Mesh(new THREE.RingGeometry(ringInnerM, ringOuterM, 24), this.ringMaterial);
    ring.rotation.x = -Math.PI / 2; // lying flat
    ring.position.y = ringLiftM;
    group.add(grenade, items.rifle, items.pistol, ring);
    this.scene.add(group);
    return { group, items };
  }
}
