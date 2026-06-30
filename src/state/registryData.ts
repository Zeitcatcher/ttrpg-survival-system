import type { ClimateBand, Counts } from "../core/types";

// The persisted Caravan registry — plain data stored in the registry document's flags.
// Pure types + normalizer (no Foundry), so it can be validated and round-tripped in tests.

export interface RegMember {
  /** Actor UUID (stable across scenes and campaigns). Also the consumer id in the engine. */
  uuid: string;
  group: string;
  enabled: boolean;
  isMount: boolean;
  /** Mounts only: whether deprivation applies real conditions (false = narrate-only). */
  applyConsequences: boolean;
  /** The member's own pool (a mount's carried supply, or a PC's personal pack). */
  poolId: string | null;
  /** Optional per-actor need override ("Грог large-eater", "0 = fasting/non-eater"). */
  needsOverride?: { food?: number; water?: number };
}

export interface RegPool {
  id: string;
  label: string;
  /** Abstract-mode day-counts (v1). In Ledger mode (v2) these are computed from real items. */
  counts: Counts;
  withParty: Record<string, boolean>;
  isMount: boolean;
  isStorage: boolean;
}

export interface RegistryData {
  dataVersion: number;
  groups: string[];
  climate: Record<string, ClimateBand>;
  members: RegMember[];
  pools: RegPool[];
}

export const CURRENT_REGISTRY_VERSION = 1;

export function emptyRegistry(): RegistryData {
  return {
    dataVersion: CURRENT_REGISTRY_VERSION,
    groups: ["Main"],
    climate: { Main: "temperate" },
    members: [],
    pools: [],
  };
}

function asCounts(c: Partial<Counts> | undefined): Counts {
  return { food: c?.food ?? 0, water: c?.water ?? 0, firewood: c?.firewood ?? 0 };
}

/** Defensive normalization of whatever is read from the document flags: fills defaults,
 *  guarantees at least one group, and ensures every group has a climate band. Never throws. */
export function normalizeRegistry(raw: Partial<RegistryData> | null | undefined): RegistryData {
  const base = emptyRegistry();
  if (!raw) return base;

  const groups = raw.groups && raw.groups.length > 0 ? [...raw.groups] : ["Main"];
  const climate: Record<string, ClimateBand> = {};
  for (const g of groups) climate[g] = raw.climate?.[g] ?? "temperate";

  const pools: RegPool[] = (raw.pools ?? []).map((p) => ({
    id: p.id,
    label: p.label ?? p.id,
    counts: asCounts(p.counts),
    withParty: { ...(p.withParty ?? {}) },
    isMount: !!p.isMount,
    isStorage: !!p.isStorage,
  }));

  const members: RegMember[] = (raw.members ?? []).map((m) => ({
    uuid: m.uuid,
    group: m.group ?? "Main",
    enabled: m.enabled ?? true,
    isMount: !!m.isMount,
    applyConsequences: !!m.applyConsequences,
    poolId: m.poolId ?? null,
    ...(m.needsOverride ? { needsOverride: m.needsOverride } : {}),
  }));

  return { dataVersion: raw.dataVersion ?? CURRENT_REGISTRY_VERSION, groups, climate, members, pools };
}
