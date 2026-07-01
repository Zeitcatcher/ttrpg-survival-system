import { AllocationLedger } from "./allocationLedger";
import { forBand } from "./climate";
import { advanceTrack, TRACKS } from "./ladder";
import { classifyPools, shortfallCause, sourceOrder } from "./resolver";
import {
  type CaravanState,
  type Consumer,
  emptyActorState,
  type LethalMode,
  type ResourceKind,
  type SourceMode,
} from "./types";

export interface TickOptions {
  sourceMode: SourceMode;
  lethal: LethalMode;
  /** Days a single advance will process before flagging montage/lump (default 14). */
  maxCatchUpDays: number;
}

export const DEFAULT_TICK_OPTIONS: TickOptions = {
  sourceMode: "communalFirst",
  lethal: "capStage3",
  maxCatchUpDays: 14,
};

export interface ConsumerDraw {
  consumerId: string;
  name: string;
  food: { need: number; got: number };
  water: { need: number; got: number };
  warm: boolean;
}

export interface Shortfall {
  consumerId: string;
  name: string;
  kind: ResourceKind;
  missing: number;
  cause: "separated" | "out";
  /** Mount deprivation with applyConsequences=false → a GM alert, no condition applied. */
  isMountNarrateOnly: boolean;
}

export interface DayGroupResolution {
  day: number;
  group: string;
  band: string;
  draws: ConsumerDraw[];
  shortfalls: Shortfall[];
  firewoodBurned: number;
  campfireLit: boolean;
}

export interface Headline {
  food: number;
  water: number;
  firewood: number;
}

export interface TickResult {
  fromDay: number;
  toDay: number;
  daysProcessed: number;
  overflow: boolean;
  perDay: DayGroupResolution[];
  /** Consolidated shortfalls from the LAST processed day (what the upkeep card shows). */
  lastDayShortfalls: Shortfall[];
  headlineByGroup: Record<string, Headline>;
  state: CaravanState;
}

function dailyGroupNeed(
  consumers: Consumer[],
  group: string,
  kind: "food" | "water",
  waterMult: number,
): number {
  let sum = 0;
  for (const c of consumers) {
    if (c.group !== group || !c.enabled || !c.needsConsumption) continue;
    const base = c.ration[kind] * c.sizeMult;
    sum += kind === "water" ? base * waterMult : base;
  }
  return sum;
}

function computeHeadline(state: CaravanState, group: string): Headline {
  const band = forBand(state.climate[group] ?? "temperate");
  const present = state.pools.filter((p) => p.withParty[group] === true);
  const sum = (kind: ResourceKind) => present.reduce((s, p) => s + p.counts[kind], 0);
  const foodNeed = dailyGroupNeed(state.consumers, group, "food", band.waterMult);
  const waterNeed = dailyGroupNeed(state.consumers, group, "water", band.waterMult);
  // Provisions extend both food and water. The headline is an at-a-glance gauge, so it counts the
  // shared reserve toward each (mildly optimistic when both lean on it); the day-by-day tick is the
  // authoritative allocator that spends provision once.
  const prov = present.reduce((s, p) => s + p.counts.provision, 0);
  return {
    food: foodNeed > 0 ? Math.floor((sum("food") + prov) / foodNeed) : 0,
    water: waterNeed > 0 ? Math.floor((sum("water") + prov) / waterNeed) : 0,
    firewood: band.bundles > 0 ? Math.floor(sum("firewood") / band.bundles) : 0,
  };
}

function resolveDayForGroup(
  state: CaravanState,
  group: string,
  day: number,
  opts: TickOptions,
): DayGroupResolution {
  const band = forBand(state.climate[group] ?? "temperate");
  const present = state.pools.filter((p) => p.withParty[group] === true);
  const classified = classifyPools(present);
  const ledger = new AllocationLedger(present);

  const consumers = state.consumers.filter(
    (c) => c.group === group && c.enabled && c.needsConsumption,
  );

  const draws: ConsumerDraw[] = [];
  const shortfalls: Shortfall[] = [];
  const satisfied = new Map<string, { food: boolean; water: boolean }>();

  for (const c of consumers) {
    if (c.ration.food === 0 && c.ration.water === 0) continue; // non-eaters (mephits, astral)
    const foodNeed = c.ration.food * c.sizeMult;
    const waterNeed = c.ration.water * c.sizeMult * band.waterMult;
    const order = sourceOrder(c, classified, opts.sourceMode);
    const gotFood = ledger.drawWithProvision(order, "food", foodNeed);
    const gotWater = ledger.drawWithProvision(order, "water", waterNeed);

    draws.push({
      consumerId: c.id,
      name: c.name,
      food: { need: foodNeed, got: gotFood },
      water: { need: waterNeed, got: gotWater },
      warm: false,
    });
    satisfied.set(c.id, { food: gotFood >= foodNeed, water: gotWater >= waterNeed });

    const narrate = c.isMount && !c.applyConsequences;
    if (gotFood < foodNeed) {
      shortfalls.push({
        consumerId: c.id, name: c.name, kind: "food", missing: foodNeed - gotFood,
        cause: shortfallCause("food", group, state.pools), isMountNarrateOnly: narrate,
      });
    }
    if (gotWater < waterNeed) {
      shortfalls.push({
        consumerId: c.id, name: c.name, kind: "water", missing: waterNeed - gotWater,
        cause: shortfallCause("water", group, state.pools), isMountNarrateOnly: narrate,
      });
    }
  }

  // Firewood / warmth: whole-camp, only if the band demands it. Never burn a partial fire.
  let campfireLit = false;
  let firewoodBurned = 0;
  if (band.bundles > 0) {
    const campOrder = [...classified.mountIds, ...classified.storageIds];
    if (ledger.totalAvailable(campOrder, "firewood") >= band.bundles) {
      ledger.draw(campOrder, "firewood", band.bundles);
      campfireLit = true;
      firewoodBurned = band.bundles;
    }
  }

  // Ladder pass (per consumer). Mounts with applyConsequences=false are narrate-only (no ladder).
  for (const c of consumers) {
    if (c.isMount && !c.applyConsequences) continue;
    if (c.ration.food === 0 && c.ration.water === 0) continue;
    const sat = satisfied.get(c.id) ?? { food: true, water: true };
    const st = (state.actorState[c.id] ??= emptyActorState());
    const warm = c.warmAuto || c.keptWarm || campfireLit;
    const coldSatisfied = !band.cold || warm;

    advanceTrack(st.hunger, TRACKS.hunger, sat.food, c.graceDays.hunger, opts.lethal);
    const thirstGrace = Math.max(0, c.graceDays.thirst - band.thirstGracePenalty);
    advanceTrack(st.thirst, TRACKS.thirst, sat.water, thirstGrace, opts.lethal);
    advanceTrack(st.cold, TRACKS.cold, coldSatisfied, c.graceDays.cold, opts.lethal, band.cold ? band.coldStagePerNight : 0);

    const d = draws.find((x) => x.consumerId === c.id);
    if (d) d.warm = warm;
  }

  // Commit the day's draws back to the pools (Abstract: write the day-count numbers).
  const snap = ledger.snapshot();
  for (const p of present) if (snap[p.id]) p.counts = snap[p.id];

  return { day, group, band: state.climate[group] ?? "temperate", draws, shortfalls, firewoodBurned, campfireLit };
}

/** Advance survival from `state.lastTickDay` to `targetDay`, one day at a time per group.
 *  A week is just targetDay = current + 7 — same loop. Beyond maxCatchUpDays it processes the
 *  cap (montage) and jumps the pointer, flagging overflow rather than silently under-charging. */
export function computeTick(
  state: CaravanState,
  targetDay: number,
  options: Partial<TickOptions> = {},
): TickResult {
  const opts: TickOptions = { ...DEFAULT_TICK_OPTIONS, ...options };
  const fromDay = state.lastTickDay;

  if (targetDay <= fromDay) {
    // No-op (idempotent re-run) or a rewind: set the pointer back without refunding.
    state.lastTickDay = targetDay;
    return {
      fromDay, toDay: targetDay, daysProcessed: 0, overflow: false, perDay: [],
      lastDayShortfalls: [], headlineByGroup: headlines(state), state,
    };
  }

  const span = targetDay - fromDay;
  const overflow = span > opts.maxCatchUpDays;
  const lastProcessed = overflow ? fromDay + opts.maxCatchUpDays : targetDay;

  const perDay: DayGroupResolution[] = [];
  for (let day = fromDay + 1; day <= lastProcessed; day++) {
    for (const group of state.groups) {
      perDay.push(resolveDayForGroup(state, group, day, opts));
    }
    state.lastTickDay = day;
  }
  // Montage: the remaining days pass off-screen; jump the pointer (no extra consumption).
  state.lastTickDay = targetDay;

  const lastDay = lastProcessed;
  const lastDayShortfalls = perDay.filter((r) => r.day === lastDay).flatMap((r) => r.shortfalls);

  return {
    fromDay, toDay: targetDay, daysProcessed: lastProcessed - fromDay, overflow,
    perDay, lastDayShortfalls, headlineByGroup: headlines(state), state,
  };
}

function headlines(state: CaravanState): Record<string, Headline> {
  const out: Record<string, Headline> = {};
  for (const g of state.groups) out[g] = computeHeadline(state, g);
  return out;
}
