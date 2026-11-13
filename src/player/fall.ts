import { healthConfig } from '../config/health';

// What landing at a speed costs (decision 115). No drawing or browser code, so tests can check it.

/** Damage from landing at `speedMps` (downward speed, positive). Zero at or below the safe speed. */
export function fallDamage(speedMps: number): number {
  return Math.max(speedMps - healthConfig.fallSafeSpeedMps, 0) * healthConfig.fallDamagePerMps;
}

/** How long walking is slowed after landing at `speedMps`. Zero at or below the safe speed. */
export function fallSlowSec(speedMps: number): number {
  const over = speedMps - healthConfig.fallSafeSpeedMps;
  if (over <= 0) return 0;
  return Math.min(healthConfig.fallSlowBaseSec + over * healthConfig.fallSlowPerMpsSec, healthConfig.fallSlowMaxSec);
}
