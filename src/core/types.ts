// Pure, system-neutral domain types. NOTHING in src/core imports Foundry or a game
// system — the engine operates on these plain snapshots, which the adapter layer builds
// from Actors and writes back. This is what makes the core fully unit-testable headless.

export type ResourceKind = "food" | "water" | "firewood";
export type DegreeOfSuccess = "critFail" | "fail" | "success" | "critSuccess";
export type TrackKey = "hunger" | "thirst" | "cold";
export type ClimateBand = "temperate" | "hot" | "extremeHeat" | "cold" | "extremeCold";
export type SourceMode = "communalFirst" | "personalFirst";
export type LethalMode = "capStage3" | "climbToDeath";

/** Per-band climate effects (see ClimateModel). */
export interface BandEffects {
  /** Daily water-need multiplier: temperate ×1, hot ×2, extremeHeat ×3. */
  waterMult: number;
  /** Whether the cold track can accrue in this band. */
  cold: boolean;
  /** Firewood bundles a camp burns per night for warmth (0 if not cold). */
  bundles: number;
  /** Days subtracted from the thirst grace window (extremeHeat = 1). */
  thirstGracePenalty: number;
  /** Extra cold-stage acceleration per unwarmed night (extremeCold = 1). */
  coldStagePerNight: number;
}

export interface Counts {
  food: number;
  water: number;
  firewood: number;
}

/** A supply pool: a mount's carried supply, a base stockpile, or a PC's personal pack.
 *  In Abstract mode (v1) `counts` are creature-day numbers stored on the Caravan doc. */
export interface Pool {
  id: string;
  label: string;
  counts: Counts;
  /** Separation, per group. A pool absent/false for a group is excluded BEFORE allocation. */
  withParty: Record<string, boolean>;
  isMount: boolean;
  isStorage: boolean;
}

/** A creature that consumes (PC, mount, NPC companion). A mount is also a Pool (by id). */
export interface Consumer {
  id: string;
  name: string;
  group: string;
  /** 1 (Medium/Small), 2 (Large), 4 (Huge), 8 (Gargantuan). */
  sizeMult: number;
  /** The system's size name for display ("Gargantuan"); null = unknown/not applicable. */
  sizeName: string | null;
  /** Base per-day need before size/climate multipliers. {0,0} = non-eater (mephits, astral). */
  ration: { food: number; water: number };
  /** Base grace window per track = Con-mod + 1 (thirst further reduced by heat at runtime). */
  graceDays: Record<TrackKey, number>;
  isMount: boolean;
  /** Mounts only: whether deprivation applies real conditions (false = narrate-only alert). */
  applyConsequences: boolean;
  enabled: boolean;
  /** False for dead / incapacitated / "doesn't eat" — skipped by the tick. */
  needsConsumption: boolean;
  /** The consumer's OWN pool (a mount's carried supply, or a PC's personal pack). null = none. */
  poolId: string | null;
  /** This night's warmth, set by a player/GM toggle. */
  keptWarm: boolean;
  /** Adapter detected warm clothing (auto-satisfies warmth). */
  warmAuto: boolean;
}

export interface TrackState {
  daysDeprived: number;
  stage: number;
  /** Stage-3 hunger/thirst: HP can't be restored until fed/watered (Decision D). */
  blockedHealing: boolean;
}

export type ActorState = Record<TrackKey, TrackState>;

/** The full mutable snapshot the engine reads and rewrites. */
export interface CaravanState {
  groups: string[];
  climate: Record<string, ClimateBand>;
  consumers: Consumer[];
  pools: Pool[];
  actorState: Record<string, ActorState>;
  lastTickDay: number;
}

export function emptyTrackState(): TrackState {
  return { daysDeprived: 0, stage: 0, blockedHealing: false };
}

export function emptyActorState(): ActorState {
  return { hunger: emptyTrackState(), thirst: emptyTrackState(), cold: emptyTrackState() };
}
