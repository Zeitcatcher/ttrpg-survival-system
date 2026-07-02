import { describe, expect, it } from "vitest";
import { computeTick } from "../src/core/engine";
import { buildShardsState } from "./fixtures/theShards";

const headlineWater = (state: ReturnType<typeof buildShardsState>) =>
  computeTick(state, state.lastTickDay).headlineByGroup.Main.water;

describe("SurvivalEngine — the Shards desert scenario", () => {
  it("charges the Gargantuan mount ×8 (and ×2 water in the heat)", () => {
    const state = buildShardsState();
    const res = computeTick(state, 1);
    const chiga = res.perDay[0].draws.find((d) => d.consumerId === "chiga");
    expect(chiga).toBeDefined();
    expect(chiga!.food.need).toBe(8); // Gargantuan ×8
    expect(chiga!.water.need).toBe(16); // ×8 × Hot ×2
  });

  it("never draws a pool negative (transactional)", () => {
    const state = buildShardsState();
    computeTick(state, 1);
    for (const p of state.pools) {
      expect(p.counts.food).toBeGreaterThanOrEqual(0);
      expect(p.counts.water).toBeGreaterThanOrEqual(0);
      expect(p.counts.firewood).toBeGreaterThanOrEqual(0);
    }
  });

  it("separation is a cliff: cutting the base drops the water headline", () => {
    const present = buildShardsState();
    const before = headlineWater(present);

    const separated = buildShardsState();
    separated.pools.find((p) => p.id === "chiga")!.withParty.Main = false;
    const after = headlineWater(separated);

    expect(after).toBeLessThan(before);
  });

  it("with the base separated, only the PC without a waterskin goes thirsty — named cause", () => {
    const state = buildShardsState();
    state.pools.find((p) => p.id === "chiga")!.withParty.Main = false;

    const res = computeTick(state, 1);
    const grog = res.lastDayShortfalls.find((s) => s.consumerId === "grog" && s.kind === "water");
    const irime = res.lastDayShortfalls.find((s) => s.consumerId === "irime" && s.kind === "water");

    expect(grog).toBeDefined();
    expect(grog!.cause).toBe("separated");
    expect(grog!.isMountNarrateOnly).toBe(false);
    expect(irime).toBeUndefined(); // covered by her own waterskin
  });

  it("a starving mount is narrate-only by default — a GM alert, no ladder", () => {
    const state = buildShardsState();
    state.pools.find((p) => p.id === "chiga")!.withParty.Main = false;

    const res = computeTick(state, 1);
    const chiga = res.lastDayShortfalls.find((s) => s.consumerId === "chiga" && s.kind === "water");
    expect(chiga).toBeDefined();
    expect(chiga!.isMountNarrateOnly).toBe(true);
    expect(state.actorState.chiga).toBeUndefined(); // no conditions applied to the NPC
  });

  it("a week advance accrues day-by-day: a separated party escalates into real stages", () => {
    const state = buildShardsState();
    state.pools.find((p) => p.id === "chiga")!.withParty.Main = false;

    const res = computeTick(state, 7);
    expect(res.daysProcessed).toBe(7);
    expect(res.overflow).toBe(false);
    // Грог (empty skin, grace 1) and Иримэ (skin lasts one day, grace 3) both reach stage 3 by day 7.
    // A single lumped pass could not reproduce this — it proves the day-interleaving.
    expect(state.actorState.grog.thirst.stage).toBe(3);
    expect(state.actorState.irime.thirst.stage).toBe(3);
  });

  it("a huge skip stops at the catch-up cap and flags overflow", () => {
    const state = buildShardsState();
    const res = computeTick(state, 40, { maxCatchUpDays: 14 });
    expect(res.overflow).toBe(true);
    expect(res.daysProcessed).toBe(14);
    expect(state.lastTickDay).toBe(40); // pointer jumps; remaining days are an off-screen montage
  });

  it("re-running the same day is idempotent (no double consumption)", () => {
    const state = buildShardsState();
    computeTick(state, 1);
    const waterAfterOne = state.pools.find((p) => p.id === "chiga")!.counts.water;
    computeTick(state, 1); // same target — should be a no-op
    expect(state.pools.find((p) => p.id === "chiga")!.counts.water).toBe(waterAfterOne);
  });
});
