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

  it("Fatigued is never duplicated even when every track demands it", () => {
    const all = planConditions({ hunger: 1, thirst: 1, cold: 1 });
    expect(all).toEqual([{ slug: "fatigued" }]);
  });
});
