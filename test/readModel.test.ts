import { describe, expect, it } from "vitest";
import { computeTick } from "../src/core/engine";
import { projectGroups } from "../src/state/readModel";
import { buildShardsState } from "./fixtures/theShards";

describe("readModel projection", () => {
  it("projects pools with the separation flag for the group", () => {
    const state = buildShardsState();
    state.pools.find((p) => p.id === "chiga")!.withParty.Main = false;
    const headline = computeTick(state, state.lastTickDay).headlineByGroup;
    const view = projectGroups(state, headline)[0];

    const base = view.pools.find((p) => p.id === "chiga")!;
    expect(base.separated).toBe(true);
    expect(base.withParty).toBe(false);
    expect(base.isMount).toBe(true);
  });

  it("exposes climate facts for the group header", () => {
    const state = buildShardsState(); // Main = hot
    const headline = computeTick(state, state.lastTickDay).headlineByGroup;
    const view = projectGroups(state, headline)[0];
    expect(view.climate).toBe("hot");
    expect(view.waterMult).toBe(2);
    expect(view.coldActive).toBe(false);
    expect(view.firewoodNeeded).toBe(false);
  });

  it("exposes the party-member flag and pool ownership for the panel controls", () => {
    const state = buildShardsState();
    state.consumers.find((c) => c.id === "grog")!.enabled = false; // e.g. a retired character
    state.pools.push({
      id: "fort", label: "Fort", counts: { food: 5, water: 5, firewood: 0 },
      withParty: { Main: true }, isMount: false, isStorage: true,
    });
    const headline = computeTick(state, state.lastTickDay).headlineByGroup;
    const view = projectGroups(state, headline)[0];

    expect(view.roster.find((r) => r.id === "grog")!.enabled).toBe(false);
    expect(view.roster.find((r) => r.id === "irime")!.enabled).toBe(true);
    expect(view.pools.find((p) => p.id === "chiga")!.hasOwner).toBe(true); // a member's own pool
    expect(view.pools.find((p) => p.id === "fort")!.hasOwner).toBe(false); // standalone base — removable
  });

  it("renders per-track clocks and status keys after a tick", () => {
    const state = buildShardsState();
    state.pools.find((p) => p.id === "chiga")!.withParty.Main = false; // strand the party
    computeTick(state, 7);
    const headline = computeTick(state, state.lastTickDay).headlineByGroup;
    const view = projectGroups(state, headline)[0];

    const grog = view.roster.find((r) => r.id === "grog")!;
    expect(grog.tracks.thirst.stage).toBe(3);
    expect(grog.tracks.thirst.statusKey).toBe("SURVIVAL.Status.thirst.3");
    expect(grog.tracks.thirst.grace).toBe(1);
    expect(grog.worstStage).toBeGreaterThanOrEqual(3);

    const mephit = view.roster.find((r) => r.id === "kvizzl")!;
    expect(mephit.zeroNeeds).toBe(true);
    expect(mephit.tracks.thirst.statusKey).toBeNull();
  });
});
