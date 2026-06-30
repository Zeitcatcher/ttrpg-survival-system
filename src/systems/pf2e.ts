import { MODULE_ID } from "../settings";
import type { DegreeOfSuccess, ResourceLot, SurvivalSystemAdapter } from "./adapter";
import { type CombinedCap, type ConditionSpec, planConditions } from "./pf2eConditions";

interface AppliedRec {
  slug: string;
  itemId: string;
  value?: number;
}

// Pathfinder 2e (Remaster, system v8.2.0) adapter. The inspection methods are pure functions of
// the actor object (unit-tested with mock actors). reconcileConsequences applies native pf2e
// conditions via the verified API, tracking the exact embedded-item ids it created so recovery
// never strips a condition the module didn't apply (e.g. a Doomed from a curse).
export class Pf2eAdapter implements SurvivalSystemAdapter {
  readonly systemId = "pf2e";

  // --- Ledger inventory (v2 / M8); unused in Abstract mode ---
  getResourceLots(): ResourceLot[] {
    return [];
  }
  getAvailable(): number {
    return 0;
  }
  async consume(): Promise<number> {
    return 0;
  }
  async grant(): Promise<void> {
    /* M8 */
  }

  // --- Creature inspection (pure; testable with mock actors) ---
  getCreatureRation(): { food: number; water: number } {
    return { food: 1, water: 1 };
  }

  getGraceDays(actor: any, _track?: "hunger" | "thirst" | "cold"): number {
    const mod = actor?.system?.abilities?.con?.mod ?? 0;
    return Math.max(0, mod + 1); // PF2e: Constitution modifier + 1 days (heat penalty applied in core)
  }

  getSizeMult(actor: any): number {
    const size = actor?.system?.traits?.size?.value;
    if (size === "huge" || size === "grg") return 4;
    if (size === "lg") return 2;
    return 1;
  }

  isMount(actor: any): boolean {
    return !!actor?.getFlag?.(MODULE_ID, "isMount");
  }

  needsConsumption(actor: any): boolean {
    const hp = actor?.system?.attributes?.hp?.value;
    return !(typeof hp === "number" && hp <= 0); // dead / dying-at-0 doesn't eat
  }

  isWarmSourceEquipped(actor: any): boolean {
    const items = actor?.items ?? [];
    for (const i of items) {
      const slug = i.slug ?? i.system?.slug;
      if (slug === "cold-weather-clothing") {
        const carry = i.system?.equipped?.carryType;
        if (carry === undefined || carry === "worn") return true;
      }
    }
    return false;
  }

  // --- Consequences (Foundry; smoke-tested in a live world) ---
  async reconcileConsequences(actor: any, stages: Record<"hunger" | "thirst" | "cold", number>): Promise<void> {
    const cap = (game.settings.get(MODULE_ID, "combinedCap") as CombinedCap) ?? "fatiguedPlusOne";
    const target: ConditionSpec[] = planConditions(stages, cap);
    const prev: AppliedRec[] = actor.getFlag?.(MODULE_ID, "applied") ?? [];
    const next: AppliedRec[] = [];

    // Remove conditions WE applied (by exact item id) that the target no longer wants.
    for (const rec of prev) {
      const wanted = target.some((t) => t.slug === rec.slug);
      const stillOurs = actor.items?.get?.(rec.itemId);
      if (!wanted && stillOurs) {
        await actor.deleteEmbeddedDocuments?.("Item", [rec.itemId]);
      }
    }

    // Assert each target condition at its value.
    for (const spec of target) {
      const existing = prev.find((p) => p.slug === spec.slug && actor.items?.get?.(p.itemId));
      if (existing) {
        if (spec.value !== undefined && existing.value !== spec.value) {
          await game.pf2e?.ConditionManager?.updateConditionValue?.(existing.itemId, actor, spec.value);
        }
        next.push({ slug: spec.slug, itemId: existing.itemId, value: spec.value });
      } else {
        const created = await actor.increaseCondition?.(
          spec.slug,
          spec.value !== undefined ? { value: spec.value } : undefined,
        );
        if (created?.id) next.push({ slug: spec.slug, itemId: created.id, value: spec.value });
      }
    }

    await actor.setFlag?.(MODULE_ID, "applied", next);
  }

  async rollForage(): Promise<DegreeOfSuccess | null> {
    return null; // M6
  }
}
