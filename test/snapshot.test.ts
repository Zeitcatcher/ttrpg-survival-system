import { describe, expect, it } from "vitest";
import { computeTick } from "../src/core/engine";
import type { ActorState } from "../src/core/types";
import { buildCaravanState, type ActorFacts } from "../src/state/snapshot";
import { normalizeRegistry } from "../src/state/registryData";

const facts = (name: string, over: Partial<ActorFacts> = {}): ActorFacts => ({
  name,
  sizeMult: 1,
  ration: { food: 1, water: 1 },
  graceDays: { hunger: 3, thirst: 3, cold: 3 },
  needsConsumption: true,
  warmAuto: false,
  keptWarm: false,
  ...over,
});

describe("snapshot builder", () => {
  it("assembles consumers and pools and runs a tick end-to-end", () => {
    const reg = normalizeRegistry({
      groups: ["Main"],
      climate: { Main: "hot" },
      members: [{ uuid: "pc1", group: "Main", poolId: null } as any],
      pools: [{ id: "base", label: "Base", counts: { food: 10, water: 10 }, withParty: { Main: true }, isStorage: true } as any],
    });
    const state = buildCaravanState(reg, { pc1: facts("Hero") }, {}, 0);
    computeTick(state, 1, { sourceMode: "communalFirst" });
    const base = state.pools.find((p) => p.id === "base")!;
    expect(base.counts.water).toBe(8); // 1 × Hot ×2
    expect(base.counts.food).toBe(9); // 1
  });

  it("applies a per-member needs override", () => {
    const reg = normalizeRegistry({
      members: [{ uuid: "x", needsOverride: { food: 0 } } as any],
    });
    const state = buildCaravanState(reg, { x: facts("Faster") }, {}, 0);
    expect(state.consumers[0].ration.food).toBe(0);
    expect(state.consumers[0].ration.water).toBe(1);
  });

  it("carries prior actor state in, cloned (does not alias the input)", () => {
    const prior: Record<string, ActorState> = {
      pc1: { hunger: { daysDeprived: 0, stage: 0, blockedHealing: false }, thirst: { daysDeprived: 4, stage: 2, blockedHealing: false }, cold: { daysDeprived: 0, stage: 0, blockedHealing: false } },
    };
    const reg = normalizeRegistry({ members: [{ uuid: "pc1" } as any] });
    const state = buildCaravanState(reg, { pc1: facts("Hero") }, prior, 5);
    expect(state.actorState.pc1.thirst.stage).toBe(2);
    expect(state.lastTickDay).toBe(5);
    state.actorState.pc1.thirst.stage = 3;
    expect(prior.pc1.thirst.stage).toBe(2); // input untouched
  });

  it("skips members the adapter could not resolve (no facts)", () => {
    const reg = normalizeRegistry({ members: [{ uuid: "present" } as any, { uuid: "ghost" } as any] });
    const state = buildCaravanState(reg, { present: facts("Here") }, {}, 0);
    expect(state.consumers.map((c) => c.id)).toEqual(["present"]);
  });
});
