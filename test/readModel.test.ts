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

  it("exposes the pooled stored total, the party-wide daily need, and the head count", () => {
    const state = buildShardsState(); // hot (water ×2); 5 PCs + Staf + Chiga (Gargantuan ×8)
    const headline = computeTick(state, state.lastTickDay).headlineByGroup;
    const view = projectGroups(state, headline)[0];

    // 7 real consumers (the 3 zero-need mephits are excluded).
    expect(view.partyCount).toBe(7);
    // Food need = 5×1 + Staf 1 + Chiga 8 = 14; water need = 14 × Hot ×2 = 28.
    expect(view.need.food).toBe(14);
    expect(view.need.water).toBe(28);
    expect(view.need.firewood).toBe(0); // hot: no fire
    // Stored is summed across present pools (Chiga base + the 5 packs).
    expect(view.stored.food).toBe(30); // Chiga 30 + packs 0
    expect(view.stored.water).toBe(38); // Chiga 30 + packs 2+2+2+0+2
  });

  it("drops the base's stores from the total once it is separated (the cliff, quantified)", () => {
    const state = buildShardsState();
    state.pools.find((p) => p.id === "chiga")!.withParty.Main = false;
    const headline = computeTick(state, state.lastTickDay).headlineByGroup;
    const view = projectGroups(state, headline)[0];
    expect(view.stored.water).toBe(8); // only the 5 packs remain (2+2+2+0+2)
    expect(view.stored.food).toBe(0);
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
