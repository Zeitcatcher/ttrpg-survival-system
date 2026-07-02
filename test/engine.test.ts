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

  describe("conjured water (Create Water)", () => {
    it("is drunk BEFORE stored water and satisfies the thirsty", () => {
      const state = buildShardsState();
      state.pools.find((p) => p.id === "chiga")!.withParty.Main = false; // strand the party
      // Грог has an empty skin; +8 conjured covers him (2 in the heat) with leftovers.
      const res = computeTick(state, 1, { conjuredWaterPerDay: 8 });
      const grog = res.lastDayShortfalls.find((s) => s.consumerId === "grog" && s.kind === "water");
      expect(grog).toBeUndefined();
      // Others drank conjured water first — their skins are untouched.
      expect(state.pools.find((p) => p.id === "pack-irime")!.counts.water).toBe(2);
    });

    it("EXPIRES at day's end: leftovers are never persisted anywhere", () => {
      const state = buildShardsState();
      state.pools.find((p) => p.id === "chiga")!.withParty.Main = false;
      const before = new Map(state.pools.map((p) => [p.id, p.counts.water]));
      computeTick(state, 1, { conjuredWaterPerDay: 50 }); // far more than one day's need
      // No pool GAINED water (leftovers evaporate), and no ghost pool appeared.
      expect(state.pools.every((p) => p.counts.water <= before.get(p.id)!)).toBe(true);
      expect(state.pools.some((p) => p.id === "__conjured")).toBe(false);
      // The next day (no cast) the shortfall returns — yesterday's leftovers are gone.
      const res2 = computeTick(state, 2);
      expect(res2.lastDayShortfalls.some((s) => s.consumerId === "grog" && s.kind === "water")).toBe(true);
    });

    it("refreshes EACH day of a multi-day advance (cast daily on consent)", () => {
      const state = buildShardsState();
      state.pools.find((p) => p.id === "chiga")!.withParty.Main = false;
      const res = computeTick(state, 3, { conjuredWaterPerDay: 30 }); // covers the whole party daily
      expect(res.perDay.every((d) => d.shortfalls.every((s) => s.kind !== "water"))).toBe(true);
      expect(state.actorState.grog.thirst.stage).toBe(0);
    });
  });

  describe("survival mode — deaths", () => {
    const stranded = () => {
      const s = buildShardsState();
      s.pools.find((p) => p.id === "chiga")!.withParty.Main = false; // strand the party (no water for Грог)
      return s;
    };

    it("reports a fatal-stage character ONLY under climbToDeath; harsh caps at 5, off at 3", () => {
      const lethal = stranded();
      const res = computeTick(lethal, 10, { lethal: "climbToDeath", pace: "fast" });
      expect(lethal.actorState.grog.thirst.stage).toBe(6);
      expect(res.deaths.some((d) => d.consumerId === "grog" && d.tracks.includes("thirst"))).toBe(true);

      const harsh = stranded();
      const rh = computeTick(harsh, 10, { lethal: "climbHarsh", pace: "fast" });
      expect(harsh.actorState.grog.thirst.stage).toBe(5);
      expect(rh.deaths).toEqual([]);

      const off = stranded();
      const ro = computeTick(off, 10, { lethal: "capStage3", pace: "fast" });
      expect(off.actorState.grog.thirst.stage).toBe(3);
      expect(ro.deaths).toEqual([]);
    });

    it("a narrate-only mount never appears in deaths, even when starving", () => {
      const state = stranded();
      const res = computeTick(state, 12, { lethal: "climbToDeath", pace: "fast" });
      expect(res.deaths.some((d) => d.consumerId === "chiga")).toBe(false);
    });
  });
});
