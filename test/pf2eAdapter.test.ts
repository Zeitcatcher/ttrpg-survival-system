import { describe, expect, it } from "vitest";
import { Pf2eAdapter } from "../src/systems/pf2e";

// The pf2e adapter's inspection methods are pure functions of the actor object, so a plain
// mock actor exercises them with no live Foundry. (reconcileConsequences is Foundry-coupled and
// smoke-tested in a world.)
const adapter = new Pf2eAdapter();

const actor = (over: any = {}) => ({
  system: {
    abilities: { con: { mod: over.conMod ?? 0 } },
    traits: { size: { value: over.size ?? "med" } },
    attributes: { hp: { value: over.hp ?? 10 } },
  },
  items: over.items ?? [],
});

describe("Pf2eAdapter inspection", () => {
  it("grace = Constitution modifier + 1", () => {
    expect(adapter.getGraceDays(actor({ conMod: 2 }), "thirst")).toBe(3);
    expect(adapter.getGraceDays(actor({ conMod: 0 }), "thirst")).toBe(1);
    expect(adapter.getGraceDays(actor({ conMod: -2 }), "thirst")).toBe(0); // clamped, never negative
  });

  it("size multiplier maps the pf2e size trait (true doubling: 1/2/4/8)", () => {
    expect(adapter.getSizeMult(actor({ size: "grg" }))).toBe(8);
    expect(adapter.getSizeMult(actor({ size: "huge" }))).toBe(4);
    expect(adapter.getSizeMult(actor({ size: "lg" }))).toBe(2);
    expect(adapter.getSizeMult(actor({ size: "med" }))).toBe(1);
    expect(adapter.getSizeMult(actor({ size: "sm" }))).toBe(1);
  });

  it("reports the real size name for display (no hardcoded 'Huge')", () => {
    expect(adapter.getSizeName(actor({ size: "grg" }))).toBe("Gargantuan");
    expect(adapter.getSizeName(actor({ size: "huge" }))).toBe("Huge");
    expect(adapter.getSizeName(actor({ size: "med" }))).toBe("Medium");
    expect(adapter.getSizeName(actor({ size: "weird" }))).toBeNull();
  });

  it("a downed creature (0 HP) does not consume", () => {
    expect(adapter.needsConsumption(actor({ hp: 10 }))).toBe(true);
    expect(adapter.needsConsumption(actor({ hp: 0 }))).toBe(false);
  });

  it("detects worn Cold-Weather Clothing as a warmth source", () => {
    const warm = actor({ items: [{ slug: "cold-weather-clothing", system: { equipped: { carryType: "worn" } } }] });
    const stowed = actor({ items: [{ slug: "cold-weather-clothing", system: { equipped: { carryType: "stowed" } } }] });
    expect(adapter.isWarmSourceEquipped(warm)).toBe(true);
    expect(adapter.isWarmSourceEquipped(stowed)).toBe(false);
    expect(adapter.isWarmSourceEquipped(actor())).toBe(false);
  });

  it("counts native Rations as FOOD (1 week = 7 charges) — never water", () => {
    const a = actor({ items: [{ slug: "rations", system: { quantity: 2 } }] });
    expect(adapter.getAvailable(a, "food")).toBe(14); // 2 × 7 food charges (no uses → 7/unit fallback)
    expect(adapter.getAvailable(a, "water")).toBe(0);
  });

  it("respects the native charge counter — a partly-used Rations stack isn't counted as full", () => {
    // 1 pack, 1 of 7 charges left (6 eaten) → 1 food-day, NOT 7.
    const partial = actor({ items: [{ slug: "rations", system: { quantity: 1, uses: { value: 1, max: 7 } } }] });
    expect(adapter.getAvailable(partial, "food")).toBe(1);
    // 2 packs, the current one at 3/7 → one full week (7) + 3 = 10.
    const twoPacks = actor({ items: [{ slug: "rations", system: { quantity: 2, uses: { value: 3, max: 7 } } }] });
    expect(adapter.getAvailable(twoPacks, "food")).toBe(10);
    // Full 2 packs (7/7) → 14 — matches the quantity-only reading.
    const full = actor({ items: [{ slug: "rations", system: { quantity: 2, uses: { value: 7, max: 7 } } }] });
    expect(adapter.getAvailable(full, "food")).toBe(14);
  });

  it("reads the module's dedicated day-items into their own kind", () => {
    const a = actor({
      items: [
        { slug: "survival-water-day", system: { quantity: 3 } },
        { slug: "survival-ration-day", system: { quantity: 4 } },
      ],
    });
    expect(adapter.getAvailable(a, "water")).toBe(3);
    expect(adapter.getAvailable(a, "food")).toBe(4);
  });
});
