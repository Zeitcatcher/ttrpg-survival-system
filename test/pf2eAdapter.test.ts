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

  it("size multiplier maps the pf2e size trait", () => {
    expect(adapter.getSizeMult(actor({ size: "huge" }))).toBe(4);
    expect(adapter.getSizeMult(actor({ size: "grg" }))).toBe(4);
    expect(adapter.getSizeMult(actor({ size: "lg" }))).toBe(2);
    expect(adapter.getSizeMult(actor({ size: "med" }))).toBe(1);
    expect(adapter.getSizeMult(actor({ size: "sm" }))).toBe(1);
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

  it("counts native Rations as fungible provisions (1 week = 7 charges), not plain food", () => {
    const a = actor({ items: [{ slug: "rations", system: { quantity: 2 } }] });
    expect(adapter.getAvailable(a, "provision")).toBe(14); // 2 × 7 charges, spendable on food OR water
    expect(adapter.getAvailable(a, "food")).toBe(0);
    expect(adapter.getAvailable(a, "water")).toBe(0);
  });

  it("reads the module's dedicated day-items into their own kind", () => {
    const a = actor({
      items: [
        { slug: "survival-water-day", system: { quantity: 3 } },
        { slug: "survival-provision-day", system: { quantity: 4 } },
      ],
    });
    expect(adapter.getAvailable(a, "water")).toBe(3);
    expect(adapter.getAvailable(a, "provision")).toBe(4);
  });
});
