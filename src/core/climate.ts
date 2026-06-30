import type { BandEffects, ClimateBand } from "./types";

// The 5-band collapse of PF2e's 9-band temperature table. Heat feeds thirst; cold drives
// the cold track. No separate "heat need" (that two-axis confusion is the documented anti-pattern).
const BANDS: Record<ClimateBand, BandEffects> = {
  temperate: { waterMult: 1, cold: false, bundles: 0, thirstGracePenalty: 0, coldStagePerNight: 0 },
  hot: { waterMult: 2, cold: false, bundles: 0, thirstGracePenalty: 0, coldStagePerNight: 0 },
  extremeHeat: { waterMult: 3, cold: false, bundles: 0, thirstGracePenalty: 1, coldStagePerNight: 0 },
  cold: { waterMult: 1, cold: true, bundles: 1, thirstGracePenalty: 0, coldStagePerNight: 0 },
  extremeCold: { waterMult: 1, cold: true, bundles: 2, thirstGracePenalty: 0, coldStagePerNight: 1 },
};

export function forBand(band: ClimateBand): BandEffects {
  return BANDS[band];
}
