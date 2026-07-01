import { describe, expect, it } from "vitest";
import { computeDegree, forageYield } from "../src/core/foraging";

describe("foraging", () => {
  it("computes the four degrees around the DC", () => {
    expect(computeDegree(25, 12, 15)).toBe("critSuccess"); // ≥ DC+10
    expect(computeDegree(16, 12, 15)).toBe("success"); // ≥ DC
    expect(computeDegree(10, 8, 15)).toBe("fail"); // < DC, > DC-10
    expect(computeDegree(4, 3, 15)).toBe("critFail"); // ≤ DC-10
  });

  it("a natural 20 bumps up and a natural 1 bumps down one degree", () => {
    expect(computeDegree(16, 20, 15)).toBe("critSuccess"); // success → crit
    expect(computeDegree(16, 1, 15)).toBe("fail"); // success → fail
    expect(computeDegree(4, 1, 15)).toBe("critFail"); // already lowest, stays
    expect(computeDegree(25, 20, 15)).toBe("critSuccess"); // already highest, stays
  });

  it("maps degrees to food yield (crit 2, success 1, else 0 + fatigue)", () => {
    expect(forageYield("critSuccess")).toEqual({ food: 2, fatigued: false });
    expect(forageYield("success")).toEqual({ food: 1, fatigued: false });
    expect(forageYield("fail")).toEqual({ food: 0, fatigued: true });
    expect(forageYield("critFail")).toEqual({ food: 0, fatigued: true });
  });
});
