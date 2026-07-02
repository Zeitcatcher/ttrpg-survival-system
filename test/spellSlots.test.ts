import { describe, expect, it } from "vitest";
import { canCastNow, countCastable } from "../src/systems/spellSlots";

// "Knowing the spell is not enough": castability = prepared & unexpended / slot / use RIGHT NOW.
describe("water-spell castability (canCastNow)", () => {
  it("prepared: castable only while the prepared slot is unexpended", () => {
    const slots = { slot1: { prepared: [{ id: "cw" }, { id: "other" }] } };
    expect(canCastNow("prepared", slots, "cw", 1)).toEqual({ ok: true, rankUsed: 1, slotId: 0 });

    const spent = { slot1: { prepared: [{ id: "cw", expended: true }] } };
    expect(canCastNow("prepared", spent, "cw", 1).ok).toBe(false);
  });

  it("prepared: knowing the spell without preparing it is NOT castable", () => {
    const slots = { slot1: { prepared: [{ id: "other" }] } };
    expect(canCastNow("prepared", slots, "cw", 1).ok).toBe(false);
  });

  it("spontaneous: needs a remaining slot of the spell's rank — or heightens into a higher one", () => {
    expect(canCastNow("spontaneous", { slot1: { value: 2, max: 3 } }, "cw", 1)).toEqual({ ok: true, rankUsed: 1 });
    expect(canCastNow("spontaneous", { slot1: { value: 0 }, slot2: { value: 1 } }, "cw", 1)).toEqual({ ok: true, rankUsed: 2 });
    expect(canCastNow("spontaneous", { slot1: { value: 0 }, slot2: { value: 0 } }, "cw", 1).ok).toBe(false);
  });

  it("innate: gated by remaining uses; focus/unknown types are not supported", () => {
    expect(canCastNow("innate", {}, "cw", 1, { innateUsesLeft: 1 }).ok).toBe(true);
    expect(canCastNow("innate", {}, "cw", 1, { innateUsesLeft: 0 }).ok).toBe(false);
    expect(canCastNow("focus", { slot1: { value: 1 } }, "cw", 1).ok).toBe(false);
  });

  it("cantrips are always castable", () => {
    expect(canCastNow("prepared", {}, "cw", 0, { isCantrip: true }).ok).toBe(true);
  });
});

// How many times a caster can spend on water when one casting isn't enough (e.g. Extreme Heat).
describe("water-spell cast count (countCastable)", () => {
  it("prepared: counts every unexpended prepared copy across ranks", () => {
    const slots = {
      slot1: { prepared: [{ id: "cw" }, { id: "cw", expended: true }, { id: "other" }] },
      slot2: { prepared: [{ id: "cw" }] },
    };
    expect(countCastable("prepared", slots, "cw", 1)).toBe(2); // two unexpended cw (the expended one and 'other' don't count)
  });

  it("spontaneous: sums remaining slots at the spell's rank or higher", () => {
    const slots = { slot1: { value: 2, max: 3 }, slot2: { value: 1, max: 2 }, slot3: { value: 0 } };
    expect(countCastable("spontaneous", slots, "cw", 1)).toBe(3); // 2 + 1 + 0
    expect(countCastable("spontaneous", slots, "cw", 2)).toBe(1); // only rank ≥ 2 counts
  });

  it("innate is gated by uses; cantrips return the cap; unknown types are zero", () => {
    expect(countCastable("innate", {}, "cw", 1, { innateUsesLeft: 3 })).toBe(3);
    expect(countCastable("prepared", {}, "cw", 0, { isCantrip: true, cantripCap: 12 })).toBe(12);
    expect(countCastable("focus", { slot1: { value: 5 } }, "cw", 1)).toBe(0);
  });
});
