import { describe, expect, it } from "vitest";
import { canCastNow } from "../src/systems/spellSlots";

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
