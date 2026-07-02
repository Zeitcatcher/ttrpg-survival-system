import { describe, expect, it } from "vitest";
import { type ConditionSpec, planConditions } from "../src/systems/pf2eConditions";

const slugs = (specs: ConditionSpec[]) => specs.map((s) => s.slug).sort();
const val = (specs: ConditionSpec[], slug: string) => specs.find((s) => s.slug === slug)?.value;

describe("planConditions (pf2e stage → conditions)", () => {
  it("nothing when no track is active", () => {
    expect(planConditions({ hunger: 0, thirst: 0, cold: 0 })).toEqual([]);
  });

  it("stage 1 of any track is just Fatigued", () => {
    expect(planConditions({ hunger: 1, thirst: 0, cold: 0 })).toEqual([{ slug: "fatigued" }]);
  });

  it("keeps a track's FULL stage signature — Frostbitten = Fatigued + Clumsy 2 + Drained 1", () => {
    const cold3 = planConditions({ hunger: 0, thirst: 0, cold: 3 });
    expect(slugs(cold3)).toEqual(["clumsy", "drained", "fatigued"]);
    expect(val(cold3, "clumsy")).toBe(2);
    expect(val(cold3, "drained")).toBe(1);
  });

  it("unions across tracks — every active track's effects coexist", () => {
    const all = planConditions({ hunger: 2, thirst: 2, cold: 2 });
    expect(slugs(all)).toEqual(["clumsy", "enfeebled", "fatigued", "sickened"]);
    expect(val(all, "enfeebled")).toBe(1);
    expect(val(all, "sickened")).toBe(1);
    expect(val(all, "clumsy")).toBe(1);
  });

  it("same-type conditions do NOT stack — highest value wins (Drained 1 + Drained 1 = Drained 1)", () => {
    const both = planConditions({ hunger: 3, thirst: 3, cold: 0 });
    expect(slugs(both)).toEqual(["drained", "fatigued"]);
    expect(val(both, "drained")).toBe(1);
  });

  it("takes the higher Drained when stages differ (hunger 4 + cold 3 = Drained 2)", () => {
    const mixed = planConditions({ hunger: 4, thirst: 0, cold: 3 });
    expect(val(mixed, "drained")).toBe(2);
    expect(val(mixed, "clumsy")).toBe(2);
    expect(mixed.some((s) => s.slug === "doomed")).toBe(true);
  });

  it("stage 5 escalates the descent (thirst 5 = Fatigued + Sickened 3 + Drained 3 + Doomed 2)", () => {
    const t5 = planConditions({ hunger: 0, thirst: 5, cold: 0 });
    expect(slugs(t5)).toEqual(["doomed", "drained", "fatigued", "sickened"]);
    expect(val(t5, "drained")).toBe(3);
    expect(val(t5, "doomed")).toBe(2);
    expect(val(t5, "sickened")).toBe(3);
  });

  it("the death stage (6) carries no new conditions — clamps to the stage-5 signature", () => {
    expect(planConditions({ hunger: 6, thirst: 0, cold: 0 })).toEqual(
      planConditions({ hunger: 5, thirst: 0, cold: 0 }),
    );
  });

  it("Fatigued is never duplicated even when every track demands it", () => {
    const all = planConditions({ hunger: 1, thirst: 1, cold: 1 });
    expect(all).toEqual([{ slug: "fatigued" }]);
  });
});
