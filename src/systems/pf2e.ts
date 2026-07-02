import { computeDegree } from "../core/foraging";
import type { ResourceKind } from "../core/types";
import { MODULE_ID } from "../settings";
import type { DegreeOfSuccess, ResourceLot, SurvivalSystemAdapter } from "./adapter";
import { type Lot, planConsume, totalAvailable } from "./ledgerMath";
import { type ConditionSpec, planConditions } from "./pf2eConditions";
import { canCastNow, type CastAvailability } from "./spellSlots";

// Day-unit supply items the module seeds / grants in Ledger mode.
const SUPPLY_SLUG: Record<ResourceKind, string> = {
  food: "survival-ration-day",
  water: "survival-water-day",
  firewood: "survival-firewood-bundle",
};
const SUPPLY_NAME: Record<ResourceKind, string> = {
  food: "Ration (day)",
  water: "Water (day)",
  firewood: "Firewood (bundle)",
};

export function supplyItemData(kind: ResourceKind, quantity: number): any {
  return {
    name: SUPPLY_NAME[kind],
    type: "consumable",
    system: {
      slug: SUPPLY_SLUG[kind],
      quantity,
      category: "other",
      description: { value: "" },
      traits: { value: [], rarity: "common" },
    },
  };
}

/** Classify a physical item as a survival resource: per-item override flag first, then the module
 *  day-item slugs, then native pf2e Rations (a week = 7 FOOD charges — never water), then a
 *  name-keyword fallback. */
function matchKind(item: any): { kind: ResourceKind; daysPerUnit: number } | null {
  const override = item.getFlag?.(MODULE_ID, "resource");
  if (override === "none") return null;
  const slug: string = item.slug ?? item.system?.slug ?? "";
  if (override === "food" || override === "water" || override === "firewood") {
    return { kind: override, daysPerUnit: slug === "rations" ? 7 : 1 };
  }
  if (slug === SUPPLY_SLUG.food) return { kind: "food", daysPerUnit: 1 };
  if (slug === SUPPLY_SLUG.water) return { kind: "water", daysPerUnit: 1 };
  if (slug === SUPPLY_SLUG.firewood) return { kind: "firewood", daysPerUnit: 1 };
  if (slug === "rations") return { kind: "food", daysPerUnit: 7 }; // 1 week = 7 food charges
  const name = String(item.name ?? "").toLowerCase();
  if (/water|waterskin|canteen|flask/.test(name)) return { kind: "water", daysPerUnit: 1 };
  if (/firewood|kindling|\bfuel\b|\blogs?\b/.test(name)) return { kind: "firewood", daysPerUnit: 1 };
  if (/ration|provision|trail\s?mix|foodstuff/.test(name)) return { kind: "food", daysPerUnit: 1 };
  return null;
}

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

  // --- Ledger inventory (v2 / M8) ---
  #lots(actor: any, kind: ResourceKind): Lot[] {
    const lots: Lot[] = [];
    for (const item of actor?.items ?? []) {
      if (!item?.isOfType?.("physical") && !item?.system?.quantity && item?.system?.quantity !== 0) continue;
      const m = matchKind(item);
      if (!m || m.kind !== kind) continue;
      const quantity = item.quantity ?? item.system?.quantity ?? 0;
      if (quantity <= 0) continue;
      lots.push({
        itemId: item.id,
        quantity,
        daysPerUnit: m.daysPerUnit,
        daysUsed: item.getFlag?.(MODULE_ID, "daysUsed") ?? 0,
      });
    }
    return lots;
  }

  getResourceLots(actor: any, kind: ResourceKind): ResourceLot[] {
    return this.#lots(actor, kind).map((l) => ({
      kind,
      available: Math.max(0, l.quantity * l.daysPerUnit - l.daysUsed),
      itemId: l.itemId,
      label: SUPPLY_NAME[kind],
    }));
  }

  getAvailable(actor: any, kind: ResourceKind): number {
    return totalAvailable(this.#lots(actor, kind));
  }

  async consume(actor: any, kind: ResourceKind, units: number): Promise<number> {
    const plan = planConsume(this.#lots(actor, kind), units);
    const updates = plan.changes
      .filter((c) => !c.delete)
      .map((c) => ({ _id: c.itemId, "system.quantity": c.newQuantity, [`flags.${MODULE_ID}.daysUsed`]: c.newDaysUsed }));
    const deletes = plan.changes.filter((c) => c.delete).map((c) => c.itemId);
    if (updates.length) await actor.updateEmbeddedDocuments?.("Item", updates);
    if (deletes.length) await actor.deleteEmbeddedDocuments?.("Item", deletes);
    return plan.drawn;
  }

  async grant(actor: any, kind: ResourceKind, units: number): Promise<void> {
    if (units <= 0) return;
    const existing = (actor?.items ?? []).find?.((i: any) => (i.slug ?? i.system?.slug) === SUPPLY_SLUG[kind]);
    if (existing) {
      const q = existing.quantity ?? existing.system?.quantity ?? 0;
      await actor.updateEmbeddedDocuments?.("Item", [{ _id: existing.id, "system.quantity": q + units }]);
    } else {
      await actor.createEmbeddedDocuments?.("Item", [supplyItemData(kind, units)]);
    }
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
    if (size === "grg") return 8; // true doubling ladder: 1 / 2 / 4 / 8
    if (size === "huge") return 4;
    if (size === "lg") return 2;
    return 1;
  }

  getSizeName(actor: any): string | null {
    const size = actor?.system?.traits?.size?.value;
    const names: Record<string, string> = {
      tiny: "Tiny", sm: "Small", med: "Medium", lg: "Large", huge: "Huge", grg: "Gargantuan",
    };
    return names[size] ?? null;
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
    const target: ConditionSpec[] = planConditions(stages);
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

  async rollForage(actor: any, dc: number): Promise<DegreeOfSuccess | null> {
    const stat = actor?.getStatistic?.("survival");
    if (!stat?.roll) return null;
    const roll = await stat.roll({ dc, action: "subsist", label: "Subsist (Survival)" });
    if (!roll) return null; // rolled but cancelled
    const d20 = roll.dice?.[0]?.results?.[0]?.result ?? 10;
    return computeDegree(roll.total, d20, dc);
  }

  async applyHotMeal(actor: any): Promise<void> {
    // Refresh rather than stack: drop any prior hot-meal marker first.
    const prior = (actor.items ?? []).filter?.((i: any) => (i.slug ?? i.system?.slug) === "hot-meal") ?? [];
    if (prior.length) await actor.deleteEmbeddedDocuments?.("Item", prior.map((i: any) => i.id));

    // Effect source: a GM-configured effect UUID, else the built-in marker.
    const uuid = game.settings.get(MODULE_ID, "hotMealEffectUuid") as string;
    let data: any = null;
    if (uuid) {
      const src = await fromUuid(uuid);
      data = src?.toObject?.() ?? null;
    }
    data ??= this.#hotMealEffect();
    await actor.createEmbeddedDocuments?.("Item", [data]);

    // Grant temporary HP ≈ character level (never reduce a larger existing pool).
    const level = actor.level ?? actor.system?.details?.level?.value ?? 1;
    const current = actor.system?.attributes?.hp?.temp ?? 0;
    if (level > current) await actor.update?.({ "system.attributes.hp.temp": level });
  }

  async seedSupplies(): Promise<void> {
    for (const kind of ["food", "water", "firewood"] as const) {
      const has = (game.items ?? []).some?.((i: any) => (i.slug ?? i.system?.slug) === SUPPLY_SLUG[kind]);
      if (!has) await Item.create?.(supplyItemData(kind, 1));
    }
  }

  // --- Water spells (Create Water) ---
  /** Find a configured water spell CASTABLE RIGHT NOW (prepared & unexpended / slot / use left). */
  #castableWaterSpell(actor: any): { spell: any; entry: any; avail: CastAvailability } | null {
    const raw = String(game.settings.get(MODULE_ID, "waterSpellSlugs") ?? "create-water");
    const slugs = raw.split(",").map((s: string) => s.trim().toLowerCase()).filter(Boolean);
    const spells = actor?.itemTypes?.spell ?? (actor?.items ?? []).filter?.((i: any) => i.type === "spell") ?? [];
    for (const spell of spells) {
      const slug = String(spell.slug ?? spell.system?.slug ?? "").toLowerCase();
      if (!slugs.includes(slug)) continue;
      const entry = spell.spellcasting ?? actor?.spellcasting?.get?.(spell.system?.location?.value);
      if (!entry) continue;
      const type = entry.system?.prepared?.value ?? "prepared";
      const rank = spell.rank ?? spell.system?.level?.value ?? 1;
      const isCantrip = spell.isCantrip ?? spell.system?.traits?.value?.includes?.("cantrip") ?? false;
      const innateUsesLeft = spell.system?.location?.uses?.value ?? 0;
      const avail = canCastNow(type, entry.system?.slots ?? {}, spell.id, rank, { isCantrip, innateUsesLeft });
      if (avail.ok) return { spell, entry, avail };
    }
    return null;
  }

  findWaterSpell(actor: any): { label: string } | null {
    const found = this.#castableWaterSpell(actor);
    return found ? { label: found.spell.name } : null;
  }

  async castWaterSpell(actor: any): Promise<boolean> {
    const found = this.#castableWaterSpell(actor);
    if (!found) return false;
    const { spell, entry, avail } = found;
    try {
      // The system's own cast path: posts the spell card AND expends the slot/use.
      await entry.cast(spell, { rank: avail.rankUsed ?? spell.rank, slotId: avail.slotId, consume: true });
      return true;
    } catch (e) {
      console.warn(`${MODULE_ID} | entry.cast failed, posting card without slot bookkeeping`, e);
      await spell.toMessage?.();
      return true;
    }
  }

  /** One line per inventory item: how it was (or wasn't) classified. Consumed by api.diagnose(). */
  diagnoseActor(actor: any): string[] {
    const lines: string[] = [];
    for (const item of actor?.items ?? []) {
      const quantity = item.quantity ?? item.system?.quantity;
      if (typeof quantity !== "number") continue; // non-physical (spells, feats…)
      const slug = item.slug ?? item.system?.slug ?? "—";
      const m = matchKind(item);
      const verdict = m
        ? `${m.kind} ×${m.daysPerUnit}/unit → ${Math.max(0, quantity * m.daysPerUnit - (item.getFlag?.(MODULE_ID, "daysUsed") ?? 0))} day(s)`
        : "not a supply";
      lines.push(`"${item.name}" (slug: ${slug}, qty: ${quantity}) → ${verdict}`);
    }
    return lines;
  }

  #hotMealEffect(): any {
    return {
      name: game.i18n.localize("SURVIVAL.HotMeal.EffectName"),
      type: "effect",
      img: "icons/svg/heal.svg",
      system: {
        slug: "hot-meal",
        description: { value: `<p>${game.i18n.localize("SURVIVAL.HotMeal.EffectDesc")}</p>` },
        rules: [],
        traits: { otherTags: [], value: [] },
        level: { value: 0 },
        duration: { value: 1, unit: "days", expiry: "turn-start", sustained: false },
        start: { value: 0, initiative: null },
        tokenIcon: { show: true },
        unidentified: false,
      },
    };
  }
}
