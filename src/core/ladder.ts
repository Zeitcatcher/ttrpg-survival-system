import type { LethalMode, Pace, TrackKey, TrackState } from "./types";

// The consequence ladders. Stage thresholds are expressed as cumulative "days past grace" to
// reach stages 1..6. Thirst escalates faster than hunger; cold matches thirst's cadence but is
// the easiest to escape (one warm night resets it). Stages 4–6 are only reachable in the lethal
// modes (climbHarsh → up to 5, climbToDeath → 6, which is death). The three *pace* rows share an
// identical first three entries, so the mild early game (stages 1–3) is the SAME regardless of
// pace — only the fatal descent (4→6) speeds up or slows down.
export interface TrackConfig {
  /** Per-pace cumulative days-past-grace to reach stages 1..6. */
  offsets: Record<Pace, [number, number, number, number, number, number]>;
  /** Stage 3+ of this track blocks HP healing until satisfied (hunger/thirst only — Decision D). */
  blockHealingAtStage3: boolean;
}

export const TRACKS: Record<TrackKey, TrackConfig> = {
  hunger: {
    // Stages 1–3 = the original [1,3,5] in every pace. 4–6 are the fatal descent.
    offsets: {
      slow: [1, 3, 5, 11, 16, 22],
      balanced: [1, 3, 5, 8, 12, 16],
      fast: [1, 3, 5, 7, 9, 11],
    },
    blockHealingAtStage3: true,
  },
  thirst: {
    offsets: {
      slow: [1, 2, 3, 6, 10, 14],
      balanced: [1, 2, 3, 5, 8, 11],
      fast: [1, 2, 3, 4, 5, 6],
    },
    blockHealingAtStage3: true,
  },
  cold: {
    offsets: {
      slow: [1, 2, 3, 6, 9, 13],
      balanced: [1, 2, 3, 5, 7, 10],
      fast: [1, 2, 3, 4, 5, 7],
    },
    blockHealingAtStage3: false,
  },
};

function lethalCap(mode: LethalMode): number {
  if (mode === "climbToDeath") return 6; // stage 6 = death
  if (mode === "climbHarsh") return 5; // extra debuffs, but never fatal
  return 3; // capStage3 — the safe default
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
  pace: Pace,
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
  const computed = stageFor(daysPastGrace, cfg.offsets[pace]);
  state.stage = Math.min(lethalCap(lethal), Math.max(state.stage, computed));
  state.blockedHealing = cfg.blockHealingAtStage3 && state.stage >= 3;
}
