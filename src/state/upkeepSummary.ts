import type { TickResult } from "../core/engine";
import type { ResourceKind, TrackKey } from "../core/types";

// PURE shaping of a tick's outcome into the daily "upkeep" summary the card + whispers render.
// No Foundry — unit-tested. Handles green-day detection (suppress) and multi-day consolidation.

export interface UpkeepShortfall {
  actorUuid: string;
  name: string;
  kind: ResourceKind;
  cause: "separated" | "out";
  isMountNarrateOnly: boolean;
}

export interface UpkeepClock {
  actorUuid: string;
  name: string;
  track: TrackKey;
  stage: number;
  statusKey: string;
}

export interface UpkeepSummary {
  group: string;
  daysProcessed: number;
  overflow: boolean;
  /** No shortfall anywhere across the whole span → the card can be suppressed to a whisper. */
  allGreen: boolean;
  /** Totals consumed across the span (creature-days / bundles). */
  consumed: { food: number; water: number; firewood: number };
  /** The final day's shortfalls (deduped by actor+kind) — who went without, and why. */
  shortfalls: UpkeepShortfall[];
  /** Every consumer currently carrying a track at stage ≥ 1. */
  clocks: UpkeepClock[];
}

const TRACKS: TrackKey[] = ["hunger", "thirst", "cold"];

export function buildUpkeepSummary(result: TickResult, group: string): UpkeepSummary {
  const days = result.perDay.filter((d) => d.group === group);

  const consumed = { food: 0, water: 0, firewood: 0 };
  for (const d of days) {
    for (const dr of d.draws) {
      consumed.food += dr.food.got;
      consumed.water += dr.water.got;
    }
    consumed.firewood += d.firewoodBurned;
  }

  const allGreen = days.length > 0 && days.every((d) => d.shortfalls.length === 0);

  // Shortfalls from the LAST processed day (the current, still-relevant state), deduped.
  const lastDay = days.reduce((m, d) => Math.max(m, d.day), result.fromDay);
  const seen = new Set<string>();
  const shortfalls: UpkeepShortfall[] = [];
  for (const d of days) {
    if (d.day !== lastDay) continue;
    for (const s of d.shortfalls) {
      const key = `${s.consumerId}:${s.kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      shortfalls.push({
        actorUuid: s.consumerId,
        name: s.name,
        kind: s.kind,
        cause: s.cause,
        isMountNarrateOnly: s.isMountNarrateOnly,
      });
    }
  }

  const clocks: UpkeepClock[] = [];
  for (const c of result.state.consumers) {
    if (c.group !== group) continue;
    const cs = result.state.actorState[c.id];
    if (!cs) continue;
    for (const track of TRACKS) {
      const stage = cs[track].stage;
      if (stage >= 1) {
        clocks.push({
          actorUuid: c.id,
          name: c.name,
          track,
          stage,
          statusKey: `SURVIVAL.Status.${track}.${Math.min(stage, 3)}`,
        });
      }
    }
  }

  return {
    group,
    daysProcessed: result.daysProcessed,
    overflow: result.overflow,
    allGreen,
    consumed,
    shortfalls,
    clocks,
  };
}
