import { describe, expect, it } from "vitest";
import { AllocationLedger } from "../src/core/allocationLedger";
import type { Pool } from "../src/core/types";

function pool(id: string, food: number, water: number, firewood = 0): Pool {
  return { id, label: id, counts: { food, water, firewood }, withParty: { Main: true }, isMount: false, isStorage: true };
}

describe("AllocationLedger", () => {
  it("draws down a pool and returns the amount actually taken", () => {
    const led = new AllocationLedger([pool("base", 10, 5)]);
    expect(led.draw(["base"], "water", 3)).toBe(3);
    expect(led.available("base", "water")).toBe(2);
    expect(led.draw(["base"], "water", 5)).toBe(2); // only 2 left
    expect(led.available("base", "water")).toBe(0);
  });

  it("walks the source order, falling through to the next pool", () => {
    const led = new AllocationLedger([pool("a", 0, 1), pool("b", 0, 10)]);
    expect(led.draw(["a", "b"], "water", 4)).toBe(4);
    expect(led.available("a", "water")).toBe(0);
    expect(led.available("b", "water")).toBe(7);
  });

  it("never lets two draws exceed initial availability (transactional invariant)", () => {
    const led = new AllocationLedger([pool("base", 0, 9)]);
    let total = 0;
    // ten consumers each want 2; the pool only has 9
    for (let i = 0; i < 10; i++) total += led.draw(["base"], "water", 2);
    expect(total).toBe(9);
    expect(led.available("base", "water")).toBe(0);
    expect(led.available("base", "water")).toBeGreaterThanOrEqual(0);
  });

  it("snapshots current counts for write-back", () => {
    const led = new AllocationLedger([pool("base", 10, 5, 4)]);
    led.draw(["base"], "firewood", 1);
    expect(led.snapshot().base).toEqual({ food: 10, water: 5, firewood: 3 });
  });
});
