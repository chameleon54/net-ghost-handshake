import type { GunConfig } from '../config/gun';

/** The hottest a gun can get. Heat runs from 0 to this. */
export const heatMax = 100;

const smooth = (t: number): number => t * t * (3 - 2 * t);

type RiskConfig = Pick<GunConfig, 'jamHeatStart' | 'jamRiskPerShotAtMaxHeat' | 'jamRiskMax'>;
type ChanceConfig = Pick<GunConfig, 'jamChanceFlat' | 'jamFreeRounds' | 'jamFreeAfterClearSec'>;

/**
 * How much jam risk one more shot adds, given how hot the gun is. Nothing below `jamHeatStart`; above it the gain rises
 * smoothly to `jamRiskPerShotAtMaxHeat` at full heat. Risk builds up while the barrel is hot and does NOT fall when it
 * cools: it goes back to 0 only when a jam happens.
 */
export function jamRiskGain(config: RiskConfig, heat: number): number {
  if (heat <= config.jamHeatStart) return 0;
  return config.jamRiskPerShotAtMaxHeat * smooth(Math.min((heat - config.jamHeatStart) / (heatMax - config.jamHeatStart), 1));
}

/** Adds one shot's worth of risk, never past the most the gun can reach. */
export function addJamRisk(config: RiskConfig, risk: number, heat: number): number {
  return Math.min(risk + jamRiskGain(config, heat), config.jamRiskMax);
}

/**
 * The chance (0 to 1) that the next shot jams: the built-up risk plus the flat chance (the pistol's rare one). Two
 * fairness guards: none in the first rounds fired from a magazine, and none for a while after a jam was cleared.
 */
export function jamChance(config: ChanceConfig, risk: number, roundsFiredFromMagazine: number, secSinceClear: number): number {
  if (roundsFiredFromMagazine < config.jamFreeRounds) return 0;
  if (secSinceClear < config.jamFreeAfterClearSec) return 0;
  return Math.min(config.jamChanceFlat + risk, 1);
}
