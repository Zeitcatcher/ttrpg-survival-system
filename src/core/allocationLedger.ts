import type { Counts, Pool, ResourceKind } from "./types";

// Transactional, in-memory allocation. Built from the PRESENT pools for one group on one day.
// Every draw decrements the working copy immediately, so two consumers can never both be told
// the pool is full. Core correctness invariant: Σ draws[kind] ≤ Σ initialAvailability[kind].
export class AllocationLedger {
  private readonly counts = new Map<string, Counts>();

  constructor(pools: Pool[]) {
    for (const p of pools) this.counts.set(p.id, { ...p.counts });
  }

  available(poolId: string, kind: ResourceKind): number {
    return this.counts.get(poolId)?.[kind] ?? 0;
  }

  totalAvailable(poolIds: readonly string[], kind: ResourceKind): number {
    let sum = 0;
    for (const id of poolIds) sum += this.available(id, kind);
    return sum;
  }

  /** Draw up to `need` of `kind`, walking `orderedPoolIds` and decrementing as it goes.
   *  Returns the amount actually drawn (≤ need). */
  draw(orderedPoolIds: readonly string[], kind: ResourceKind, need: number): number {
    let remaining = need;
    for (const id of orderedPoolIds) {
      if (remaining <= 0) break;
      const c = this.counts.get(id);
      if (!c) continue;
      const take = Math.min(c[kind], remaining);
      if (take > 0) {
        c[kind] -= take;
        remaining -= take;
      }
    }
    return need - remaining;
  }

  /** Draw `kind` (food/water) first, then top up any shortfall from the shared `provision`
   *  reserve along the same order. Provision decrements as it's spent, so food and water (and
   *  every consumer) share one fungible pool — the transactional invariant still holds. */
  drawWithProvision(orderedPoolIds: readonly string[], kind: "food" | "water", need: number): number {
    const got = this.draw(orderedPoolIds, kind, need);
    let remaining = need - got;
    for (const id of orderedPoolIds) {
      if (remaining <= 0) break;
      const c = this.counts.get(id);
      if (!c || c.provision <= 0) continue;
      const take = Math.min(c.provision, remaining);
      c.provision -= take;
      remaining -= take;
    }
    return need - remaining;
  }

  /** Current counts per pool (to write back to the registry after the day commits). */
  snapshot(): Record<string, Counts> {
    const out: Record<string, Counts> = {};
    for (const [id, c] of this.counts) out[id] = { ...c };
    return out;
  }
}
