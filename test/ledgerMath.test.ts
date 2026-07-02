import { describe, expect, it } from "vitest";
import { type Lot, lotAvailable, planConsume, totalAvailable, weekStackFor } from "../src/systems/ledgerMath";

const lot = (itemId: string, quantity: number, daysPerUnit = 1, daysUsed = 0): Lot => ({
  itemId, quantity, daysPerUnit, daysUsed,
});

describe("ledger math", () => {
  it("computes availability incl. partially-used week rations", () => {
    expect(lotAvailable(lot("w", 5))).toBe(5); // 5 day-units
    expect(lotAvailable(lot("r", 2, 7))).toBe(14); // 2 weeks = 14 days
    expect(lotAvailable(lot("r", 2, 7, 3))).toBe(11); // 3 already eaten
    expect(totalAvailable([lot("a", 3), lot("r", 1, 7)])).toBe(10);
  });

  it("draws whole day-units", () => {
    const plan = planConsume([lot("w", 5)], 3);
    expect(plan.drawn).toBe(3);
    expect(plan.changes[0]).toEqual({ itemId: "w", newQuantity: 2, newDaysUsed: 0, delete: false });
  });

  it("decomposes a week ration across days, tracking the partial (the 7-ration rule)", () => {
    const first = planConsume([lot("r", 2, 7)], 3); // eat 3 of a fresh 2-week stack
    expect(first.drawn).toBe(3);
    expect(first.changes[0]).toEqual({ itemId: "r", newQuantity: 2, newDaysUsed: 3, delete: false });

    const second = planConsume([lot("r", 2, 7, 3)], 5); // 3 already used, eat 5 more → crosses a week
    expect(second.drawn).toBe(5);
    expect(second.changes[0]).toEqual({ itemId: "r", newQuantity: 1, newDaysUsed: 1, delete: false });
  });

  it("deletes a stack when fully drained", () => {
    const plan = planConsume([lot("w", 2)], 2);
    expect(plan.changes[0]).toEqual({ itemId: "w", newQuantity: 0, newDaysUsed: 0, delete: true });
  });

  it("falls through lots and reports a shortfall when the total is exhausted", () => {
    const plan = planConsume([lot("a", 1), lot("b", 1, 7)], 20);
    expect(plan.drawn).toBe(8); // 1 + 7
    expect(plan.changes.map((c) => c.itemId)).toEqual(["a", "b"]);
    expect(plan.changes.every((c) => c.delete)).toBe(true);
  });

  it("never over-draws (Σ drawn ≤ availability)", () => {
    const lots = [lot("a", 3), lot("b", 2, 7, 4)];
    const avail = totalAvailable(lots);
    for (const req of [0, 1, 5, avail, avail + 10]) {
      expect(planConsume(lots, req).drawn).toBeLessThanOrEqual(avail);
    }
  });

  it("weekStackFor represents food-days as whole Rations + a partial counter (grant inverse)", () => {
    expect(weekStackFor(7, 7)).toEqual({ quantity: 1, daysUsed: 0 }); // one clean week
    expect(weekStackFor(14, 7)).toEqual({ quantity: 2, daysUsed: 0 });
    expect(weekStackFor(8, 7)).toEqual({ quantity: 2, daysUsed: 6 }); // 2 rations, 6 already eaten → 8 left
    expect(weekStackFor(1, 7)).toEqual({ quantity: 1, daysUsed: 6 });
    expect(weekStackFor(0, 7)).toEqual({ quantity: 0, daysUsed: 0 });
    expect(weekStackFor(5, 1)).toEqual({ quantity: 5, daysUsed: 0 }); // day-units are identity
  });

  it("weekStackFor round-trips through lotAvailable for any day-count", () => {
    for (const days of [1, 3, 7, 8, 10, 13, 14, 21]) {
      const s = weekStackFor(days, 7);
      expect(lotAvailable({ itemId: "r", quantity: s.quantity, daysPerUnit: 7, daysUsed: s.daysUsed })).toBe(days);
    }
  });
});
