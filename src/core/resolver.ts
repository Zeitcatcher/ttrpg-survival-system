import type { Consumer, Pool, ResourceKind, SourceMode } from "./types";

// Source ordering for the resolver. Separation is already applied upstream (callers pass only
// PRESENT pools), so this just decides the priority chain per consumer.

export interface ClassifiedPools {
  mountIds: string[];
  storageIds: string[];
  present: Pool[];
}

export function classifyPools(presentPools: Pool[]): ClassifiedPools {
  const mountIds: string[] = [];
  const storageIds: string[] = [];
  for (const p of presentPools) {
    if (p.isMount) mountIds.push(p.id);
    else if (p.isStorage) storageIds.push(p.id);
  }
  return { mountIds, storageIds, present: presentPools };
}

function dedupe(ids: (string | null)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** The ordered pool chain a consumer draws from.
 *  - Mounts draw their OWN carried supply, then storage — never a PC's pack.
 *  - PCs use communal-first (mount/base → storage → own pack) or personal-first (own → communal). */
export function sourceOrder(
  consumer: Consumer,
  pools: ClassifiedPools,
  mode: SourceMode,
): string[] {
  if (consumer.isMount) {
    return dedupe([consumer.poolId, ...pools.storageIds]);
  }
  const communal = [...pools.mountIds, ...pools.storageIds];
  return mode === "communalFirst"
    ? dedupe([...communal, consumer.poolId])
    : dedupe([consumer.poolId, ...communal]);
}

/** A best-effort named cause for a shortfall: if a separated pool holds this resource, the
 *  party simply can't reach it; otherwise the supplies are genuinely out. */
export function shortfallCause(
  kind: ResourceKind,
  group: string,
  allPools: Pool[],
): "separated" | "out" {
  const separatedHasIt = allPools.some(
    (p) => p.withParty[group] !== true && p.counts[kind] > 0,
  );
  return separatedHasIt ? "separated" : "out";
}
