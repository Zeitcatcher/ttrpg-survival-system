import { describe, expect, it } from "vitest";
import { type ConditionSpec, planConditions } from "../src/systems/pf2eConditions";

const slugs = (specs: ConditionSpec[]) => specs.map((s) => s.slug).sort();
const val = (specs: ConditionSpec[], slug: string) => specs.find((s) => s.slug === slug)?.value;

describe("planConditions (pf2e stage → conditions)", () => {
  it("nothing when no track is active", () => {
    expect(planConditions({ hunger: 0, thirst: 0, cold: 0 }, "fatiguedPlusOne")).toEqual([]);
  });

  it("stage 1 of any track is just Fatigued", () => {
    expect(planConditions({ hunger: 1, thirst: 0, cold: 0 }, "fatiguedPlusOne")).toEqual([{ slug: "fatigued" }]);
  });

  it("capped: a deprived character never carries more than Fatigued + one other", () => {
    const capped = planConditions({ hunger: 2, thirst: 2, cold: 2 }, "fatiguedPlusOne");
    expect(capped.length).toBe(2);
    expect(capped.some((s) => s.slug === "fatigued")).toBe(true);
    // enfeebled (sev 4) beats sickened (3) and clumsy (2) for the single "other" slot
    expect(val(capped, "enfeebled")).toBe(1);
  });

  it("capped: the most severe condition wins the 'other' slot (cold stage 3 → drained, not clumsy)", () => {
    const capped = planConditions({ hunger: 0, thirst: 0, cold: 3 }, "fatiguedPlusOne");
    expect(slugs(capped)).toEqual(["drained", "fatigued"]);
    expect(val(capped, "drained")).toBe(1);
  });

  it("uncapped: the full union of every active track stacks", () => {
    const full = planConditions({ hunger: 2, thirst: 2, cold: 2 }, "uncapped");
    expect(slugs(full)).toEqual(["clumsy", "enfeebled", "fatigued", "sickened"]);
  });

  it("uncapped: same-slug conditions take the max value (no double-stacking Drained)", () => {
    const full = planConditions({ hunger: 3, thirst: 3, cold: 0 }, "uncapped");
    expect(slugs(full)).toEqual(["drained", "fatigued"]);
    expect(val(full, "drained")).toBe(1);
  });

  it("terminal stage 4 reaches Doomed", () => {
    const full = planConditions({ hunger: 4, thirst: 0, cold: 0 }, "uncapped");
    expect(full.some((s) => s.slug === "doomed")).toBe(true);
    expect(val(full, "drained")).toBe(2);
  });
});
