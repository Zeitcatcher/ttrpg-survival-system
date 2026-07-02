import { computeDegree } from "../core/foraging";
import type { ResourceKind } from "../core/types";
import { MODULE_ID } from "../settings";
import type { DegreeOfSuccess, ResourceLot, SurvivalSystemAdapter } from "./adapter";
import { type Lot, planConsume, totalAvailable, weekStackFor } from "./ledgerMath";
import { type ConditionSpec, planConditions } from "./pf2eConditions";
import { canCastNow, countCastable } from "./spellSlots";

// The native pf2e Rations item = one week of food. Food is read AND granted through it.
const RATIONS_SLUG = "rations";
const RATIONS_DAYS = 7;

// Day-unit supply items for WATER / FIREWOOD (pf2e has no per-day standard for these). Food is
// intentionally absent — it is the native Rations item, not a bespoke "Ration (day)".
const SUPPLY_SLUG: Record<"water" | "firewood", string> = {
  water: "survival-water-day",
  firewood: "survival-firewood-bundle",
};
const SUPPLY_NAME: Record<"water" | "firewood", string> = {
  water: "Water (day)",
  firewood: "Firewood (bundle)",
};

export function supplyItemData(kind: "water" | "firewood", quantity: number): any {
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
  if (slug === "survival-ration-day") return { kind: "food", daysPerUnit: 1 }; // legacy pre-0.5.1 food item
  if (slug === SUPPLY_SLUG.water) return { kind: "water", daysPerUnit: 1 };
  if (slug === SUPPLY_SLUG.firewood) return { kind: "firewood", daysPerUnit: 1 };
  if (slug === RATIONS_SLUG) return { kind: "food", daysPerUnit: RATIONS_DAYS }; // native pf2e Rations = 1 week
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

/** A ledger lot plus whether its partial counter lives in the item's native `system.uses`
 *  (charge-based consumables like Rations) or the module's own `daysUsed` flag. */
interface PfLot extends Lot {
  usesBased: boolean;
}

// Pathfinder 2e (Remaster, system v8.2.0) adapter. The inspection methods are pure functions of
// the actor object (unit-tested with mock actors). reconcileConsequences applies native pf2e
// conditions via the verified API, tracking the exact embedded-item ids it created so recovery
// never strips a condition the module didn't apply (e.g. a Doomed from a curse).
export class Pf2eAdapter implements SurvivalSystemAdapter {
  readonly systemId = "pf2e";

  // --- Ledger inventory (v2 / M8) ---
  #lots(actor: any, kind: ResourceKind): PfLot[] {
    const lots: PfLot[] = [];
    for (const item of actor?.items ?? []) {
      if (!item?.isOfType?.("physical") && !item?.system?.quantity && item?.system?.quantity !== 0) continue;
      const m = matchKind(item);
      if (!m || m.kind !== kind) continue;
      const quantity = item.quantity ?? item.system?.quantity ?? 0;
      if (quantity <= 0) continue;
      // Charge-based consumables (native pf2e Rations = 7 uses) carry their OWN day counter in
      // system.uses — use it, so a partly-eaten stack (e.g. 1 of 7) reads as 1 day, not a full 7.
      // The module's `daysUsed` flag is the fallback for items with no uses (its own day-items).
      const usesMax = Number(item.system?.uses?.max ?? 0);
      if (usesMax > 0) {
        const value = Math.max(0, Math.min(Number(item.system?.uses?.value ?? usesMax), usesMax));
        lots.push({ itemId: item.id, quantity, daysPerUnit: usesMax, daysUsed: usesMax - value, usesBased: true });
      } else {
        lots.push({
          itemId: item.id, quantity, daysPerUnit: m.daysPerUnit,
          daysUsed: item.getFlag?.(MODULE_ID, "daysUsed") ?? 0, usesBased: false,
        });
      }
    }
    return lots;
  }

  getResourceLots(actor: any, kind: ResourceKind): ResourceLot[] {
    return this.#lots(actor, kind).map((l) => ({
      kind,
      available: Math.max(0, l.quantity * l.daysPerUnit - l.daysUsed),
      itemId: l.itemId,
      label: kind === "food" ? "Rations" : SUPPLY_NAME[kind],
    }));
  }

  getAvailable(actor: any, kind: ResourceKind): number {
    return totalAvailable(this.#lots(actor, kind));
  }

  async consume(actor: any, kind: ResourceKind, units: number): Promise<number> {
    const lots = this.#lots(actor, kind);
    const byId = new Map(lots.map((l) => [l.itemId, l]));
    const plan = planConsume(lots, units);
    const updates: any[] = [];
    const deletes: string[] = [];
    for (const c of plan.changes) {
      if (c.delete) {
        deletes.push(c.itemId);
        continue;
      }
      const lot = byId.get(c.itemId);
      if (lot?.usesBased) {
        // Write the remaining charges back to the native counter so the sheet and module agree.
        updates.push({ _id: c.itemId, "system.quantity": c.newQuantity, "system.uses.value": lot.daysPerUnit - c.newDaysUsed });
      } else {
        updates.push({ _id: c.itemId, "system.quantity": c.newQuantity, [`flags.${MODULE_ID}.daysUsed`]: c.newDaysUsed });
      }
    }
    if (updates.length) await actor.updateEmbeddedDocuments?.("Item", updates);
    if (deletes.length) await actor.deleteEmbeddedDocuments?.("Item", deletes);
    return plan.drawn;
  }

  async grant(actor: any, kind: ResourceKind, units: number): Promise<void> {
    if (units <= 0) return;
    // Food is granted as the native pf2e Rations item (1 week = 7 charges), not a bespoke item.
    if (kind === "food") return this.#grantFood(actor, units);
    // Water/firewood have no per-day pf2e standard — use the module's day-unit consumables.
    const existing = (actor?.items ?? []).find?.((i: any) => (i.slug ?? i.system?.slug) === SUPPLY_SLUG[kind]);
    if (existing) {
      const q = existing.quantity ?? existing.system?.quantity ?? 0;
      await actor.updateEmbeddedDocuments?.("Item", [{ _id: existing.id, "system.quantity": q + units }]);
    } else {
      await actor.createEmbeddedDocuments?.("Item", [supplyItemData(kind, units)]);
    }
  }

  /** Add `days` of food as native Rations, preserving the exact day-count via the partial-week
   *  counter: bump an existing Rations stack, else create one (cloned from the SRD when possible). */
  async #grantFood(actor: any, days: number): Promise<void> {
    const existing = (actor?.items ?? []).find?.((i: any) => (i.slug ?? i.system?.slug) === RATIONS_SLUG);
    if (existing) {
      const usesMax = Number(existing.system?.uses?.max ?? 0);
      const hasUses = usesMax > 0;
      const max = hasUses ? usesMax : RATIONS_DAYS;
      const q = existing.quantity ?? existing.system?.quantity ?? 0;
      const daysUsed = hasUses
        ? max - Math.max(0, Math.min(Number(existing.system?.uses?.value ?? max), max))
        : (existing.getFlag?.(MODULE_ID, "daysUsed") ?? 0);
      const stack = weekStackFor(Math.max(0, q * max - daysUsed) + days, max);
      const update: any = { _id: existing.id, "system.quantity": stack.quantity };
      if (hasUses) update["system.uses.value"] = max - stack.daysUsed;
      else update[`flags.${MODULE_ID}.daysUsed`] = stack.daysUsed;
      await actor.updateEmbeddedDocuments?.("Item", [update]);
    } else {
      const data = await this.#rationsItemData(1);
      const usesMax = Number(data.system?.uses?.max ?? 0);
      const max = usesMax > 0 ? usesMax : RATIONS_DAYS;
      const stack = weekStackFor(days, max);
      data.system.quantity = stack.quantity;
      if (usesMax > 0) data.system.uses = { ...data.system.uses, value: max - stack.daysUsed };
      else if (stack.daysUsed > 0) data.flags = { ...(data.flags ?? {}), [MODULE_ID]: { daysUsed: stack.daysUsed } };
      await actor.createEmbeddedDocuments?.("Item", [data]);
    }
  }

  /** A native Rations item to create: a GM-pointed source, else the pf2e SRD Rations, else a
   *  well-formed inline fallback (always slug `rations`, so the reader treats it as 7-day food). */
  async #rationsItemData(quantity: number): Promise<any> {
    const uuid = game.settings.get(MODULE_ID, "rationsSourceUuid") as string;
    if (uuid) {
      const obj = (await fromUuid(uuid))?.toObject?.();
      if (obj) return { ...obj, system: { ...obj.system, quantity } };
    }
    const srd = await this.#findCompendiumRations();
    if (srd) {
      const obj = srd.toObject();
      obj.system.quantity = quantity;
      return obj;
    }
    return {
      name: "Rations", type: "consumable", img: "icons/consumables/food/bowl-oatmeal-brown.webp",
      system: { slug: RATIONS_SLUG, quantity, category: "other", description: { value: "" }, traits: { value: [], rarity: "common" } },
    };
  }

  async #findCompendiumRations(): Promise<any> {
    try {
      const pack = game.packs?.get?.("pf2e.equipment-srd");
      if (!pack) return null;
      const index = pack.index?.size ? pack.index : await pack.getIndex();
      const entries = [...index];
      const entry = entries.find((e: any) => e.system?.slug === RATIONS_SLUG) ?? entries.find((e: any) => e.name === "Rations");
      return entry ? await pack.getDocument(entry._id) : null;
    } catch (e) {
      console.warn(`${MODULE_ID} | SRD Rations lookup failed — using inline fallback`, e);
      return null;
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
    // Food is the native Rations item (in the pf2e SRD compendium) — only water/firewood are seeded.
    for (const kind of ["water", "firewood"] as const) {
      const has = (game.items ?? []).some?.((i: any) => (i.slug ?? i.system?.slug) === SUPPLY_SLUG[kind]);
      if (!has) await Item.create?.(supplyItemData(kind, 1));
    }
  }

  // --- Water spells (Create Water) ---
  /** Every configured water spell the actor knows, with its live casting entry, type, and rank. */
  #waterSpells(actor: any): { spell: any; entry: any; type: string; rank: number; isCantrip: boolean }[] {
    const raw = String(game.settings.get(MODULE_ID, "waterSpellSlugs") ?? "create-water");
    const slugs = raw.split(",").map((s: string) => s.trim().toLowerCase()).filter(Boolean);
    const spells = actor?.itemTypes?.spell ?? (actor?.items ?? []).filter?.((i: any) => i.type === "spell") ?? [];
    const out: { spell: any; entry: any; type: string; rank: number; isCantrip: boolean }[] = [];
    for (const spell of spells) {
      const slug = String(spell.slug ?? spell.system?.slug ?? "").toLowerCase();
      if (!slugs.includes(slug)) continue;
      const entry = spell.spellcasting ?? actor?.spellcasting?.get?.(spell.system?.location?.value);
      if (!entry) continue;
      const type = entry.system?.prepared?.value ?? "prepared";
      const rank = spell.rank ?? spell.system?.level?.value ?? 1;
      const isCantrip = spell.isCantrip ?? spell.system?.traits?.value?.includes?.("cantrip") ?? false;
      out.push({ spell, entry, type, rank, isCantrip });
    }
    return out;
  }

  /** Water spells CASTABLE RIGHT NOW, each with how many times it can be cast (slots/uses), so a
   *  player can spend several when one casting isn't enough. */
  findWaterSpells(actor: any): { spellId: string; label: string; rank: number; maxCasts: number }[] {
    const result: { spellId: string; label: string; rank: number; maxCasts: number }[] = [];
    for (const { spell, entry, type, rank, isCantrip } of this.#waterSpells(actor)) {
      const innateUsesLeft = spell.system?.location?.uses?.value ?? 0;
      const maxCasts = countCastable(type, entry.system?.slots ?? {}, spell.id, rank, { isCantrip, innateUsesLeft });
      if (maxCasts > 0) result.push({ spellId: spell.id, label: spell.name, rank, maxCasts });
    }
    return result;
  }

  /** Cast one specific water spell up to `count` times, expending a slot/use and posting the card
   *  each time. Re-checks castability every iteration; returns how many actually went off. */
  async castWaterSpellById(actor: any, spellId: string, count: number): Promise<number> {
    const found = this.#waterSpells(actor).find((f) => f.spell.id === spellId);
    if (!found) return 0;
    const { spell, entry, type, rank, isCantrip } = found;
    let done = 0;
    for (let i = 0; i < Math.max(0, count); i++) {
      const innateUsesLeft = spell.system?.location?.uses?.value ?? 0;
      const avail = canCastNow(type, entry.system?.slots ?? {}, spell.id, rank, { isCantrip, innateUsesLeft });
      if (!avail.ok) break;
      try {
        await entry.cast(spell, { rank: avail.rankUsed ?? rank, slotId: avail.slotId, consume: true });
      } catch (e) {
        console.warn(`${MODULE_ID} | entry.cast failed, posting card without slot bookkeeping`, e);
        await spell.toMessage?.();
      }
      done++;
    }
    return done;
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
