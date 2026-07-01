import { describe, expect, it } from "vitest";
import { computeTick } from "../src/core/engine";
import type { CaravanState } from "../src/core/types";
import { buildUpkeepSummary } from "../src/state/upkeepSummary";
import { buildShardsState } from "./fixtures/theShards";

function greenState(): CaravanState {
  return {
    groups: ["Main"],
    climate: { Main: "temperate" },
    consumers: [
      {
        id: "a", name: "A", group: "Main", sizeMult: 1,
        ration: { food: 1, water: 1 }, graceDays: { hunger: 3, thirst: 3, cold: 3 },
        isMount: false, applyConsequences: false, enabled: true, needsConsumption: true,
        poolId: null, keptWarm: false, warmAuto: false,
      },
    ],
    pools: [
      { id: "base", label: "Base", counts: { food: 10, water: 10, firewood: 0, provision: 0 }, withParty: { Main: true }, isMount: false, isStorage: true },
    ],
    actorState: {},
    lastTickDay: 0,
  };
}

describe("buildUpkeepSummary", () => {
  it("a fully-supplied day is all-green with no shortfalls", () => {
    const s = buildUpkeepSummary(computeTick(greenState(), 1), "Main");
    expect(s.allGreen).toBe(true);
    expect(s.shortfalls).toEqual([]);
    expect(s.clocks).toEqual([]);
    expect(s.consumed.food).toBe(1);
    expect(s.consumed.water).toBe(1);
  });

  it("consolidates a week: totals, named-cause shortfalls, and clocks in one summary", () => {
    const state = buildShardsState();
    state.pools.find((p) => p.id === "chiga")!.withParty.Main = false; // strand the party
    const s = buildUpkeepSummary(computeTick(state, 7), "Main");

    expect(s.daysProcessed).toBe(7);
    expect(s.allGreen).toBe(false);
    expect(s.consumed.water).toBeGreaterThan(0);

    const grogWater = s.shortfalls.find((x) => x.actorUuid === "grog" && x.kind === "water");
    expect(grogWater?.cause).toBe("separated");

    const grogThirst = s.clocks.find((c) => c.actorUuid === "grog" && c.track === "thirst");
    expect(grogThirst?.stage).toBe(3);
    expect(grogThirst?.statusKey).toBe("SURVIVAL.Status.thirst.3");

    // a narrate-only mount that ran dry appears as a shortfall flagged narrate-only, with no clock
    const chiga = s.shortfalls.find((x) => x.actorUuid === "chiga");
    expect(chiga?.isMountNarrateOnly).toBe(true);
    expect(s.clocks.some((c) => c.actorUuid === "chiga")).toBe(false);
  });
});
