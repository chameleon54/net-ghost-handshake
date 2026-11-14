import { Box3, Ray, Sphere, Vector3 } from 'three';
import { dummyConfig } from '../config/dummy';
import type { HitZone } from './dummy';
import type { Target } from './target';

/** Where a bullet ray met a dummy. Reused between calls: read it straight away. */
export interface DummyHit {
  distanceM: number;
  zone: HitZone;
  point: Vector3;
}

export function createDummyHit(): DummyHit {
  return { distanceM: 0, zone: 'body', point: new Vector3() };
}

const bodyBox = new Box3();
const headSphere = new Sphere();
const headPoint = new Vector3();
const bodyPoint = new Vector3();

/**
 * Tests the ray against a standing dummy's (or any dummy-shaped target's) head (a sphere on top) and body (a box). The nearer one wins; the head
 * wins a tie. Returns false if neither is hit within `maxDistanceM`. `ray.direction` must be a unit vector.
 */
export function rayHitDummy(ray: Ray, dummy: Target, maxDistanceM: number, out: DummyHit): boolean {
  if (!dummy.hittable) return false;
  const { bodyWidthM, bodyDepthM, headRadiusM } = dummyConfig;
  const bodyHeightM = dummy.heightM - 2 * headRadiusM; // a crouched target is shorter, its head lower
  bodyBox.min.set(dummy.xM - bodyWidthM / 2, 0, dummy.zM - bodyDepthM / 2);
  bodyBox.max.set(dummy.xM + bodyWidthM / 2, bodyHeightM, dummy.zM + bodyDepthM / 2);
  headSphere.center.set(dummy.xM, bodyHeightM + headRadiusM, dummy.zM);
  headSphere.radius = headRadiusM;

  const headM = ray.intersectSphere(headSphere, headPoint) ? ray.origin.distanceTo(headPoint) : Infinity;
  const bodyM = ray.intersectBox(bodyBox, bodyPoint) ? ray.origin.distanceTo(bodyPoint) : Infinity;
  const nearestM = Math.min(headM, bodyM);
  if (nearestM > maxDistanceM) return false;

  out.distanceM = nearestM;
  out.zone = headM <= bodyM ? 'head' : 'body';
  out.point.copy(headM <= bodyM ? headPoint : bodyPoint);
  return true;
}
