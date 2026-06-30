import type { LethalMode, TrackKey, TrackState } from "./types";

// The consequence ladders. Stage thresholds are expressed as cumulative "days past grace".
// Thirst escalates faster than hunger; cold matches thirst's cadence but is the easiest to
// escape (one warm night resets it). Stage 4 (terminal) only reachable when lethal = climbToDeath.
export interface TrackConfig {
  /** Cumulative days-past-grace to reach stage 1, 2, 3, 4. */
  offsets: [number, number, number, number];
  /** Stage 3 of this track blocks HP healing until satisfied (hunger/thirst only — Decision D). */
  blockHealingAtStage3: boolean;
}

export const TRACKS: Record<TrackKey, TrackConfig> = {
  // S1 first day past grace, S2 +2, S3 +2, S4 +3 (terminal).
  hunger: { offsets: [1, 3, 5, 8], blockHealingAtStage3: true },
  // Faster: S1 +1, S2 +1, S3 +1, S4 +2.
  thirst: { offsets: [1, 2, 3, 5], blockHealingAtStage3: true },
  // Same cadence as thirst, but suppressed entirely while warm.
  cold: { offsets: [1, 2, 3, 5], blockHealingAtStage3: false },
};

function lethalCap(mode: LethalMode): number {
  return mode === "climbToDeath" ? 4 : 3;
}

function stageFor(daysPastGrace: number, offsets: readonly number[]): number {
  let stage = 0;
  for (const o of offsets) if (daysPastGrace >= o) stage++;
  return stage;
}

/** Advance or recover one track for one day.
 *  - satisfied → reset the counter and step the stage toward 0 (recovery), unblock healing.
 *  - deprived  → increment the counter (cold may accelerate) and (re)compute the stage, capped.
 *  Stage is monotonic while deprived and steps down by 1 per satisfied day. */
export function advanceTrack(
  state: TrackState,
  cfg: TrackConfig,
  satisfied: boolean,
  grace: number,
  lethal: LethalMode,
  coldExtra = 0,
): void {
  if (satisfied) {
    state.daysDeprived = 0;
    state.stage = Math.max(0, state.stage - 1);
    state.blockedHealing = false;
    return;
  }
  state.daysDeprived += 1 + Math.max(0, coldExtra);
  const daysPastGrace = state.daysDeprived - grace;
  const computed = stageFor(daysPastGrace, cfg.offsets);
  state.stage = Math.min(lethalCap(lethal), Math.max(state.stage, computed));
  state.blockedHealing = cfg.blockHealingAtStage3 && state.stage >= 3;
}
