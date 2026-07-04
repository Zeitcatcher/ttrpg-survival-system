import { describe, expect, it } from "vitest";
import { advanceTrack, recoverStep, TRACKS } from "../src/core/ladder";
import { emptyTrackState } from "../src/core/types";

describe("LadderEngine", () => {
  it("respects the grace window before any stage", () => {
    const st = emptyTrackState();
    // thirst grace 1: day 1 deprived is still within grace, day 2 tips to stage 1
    advanceTrack(st, TRACKS.thirst, false, 1, "capStage3", "balanced");
    expect(st.stage).toBe(0);
    advanceTrack(st, TRACKS.thirst, false, 1, "capStage3", "balanced");
    expect(st.stage).toBe(1);
  });

  it("escalates thirst faster than hunger", () => {
    const t = emptyTrackState();
    const h = emptyTrackState();
    for (let i = 0; i < 4; i++) {
      advanceTrack(t, TRACKS.thirst, false, 1, "capStage3", "balanced");
      advanceTrack(h, TRACKS.hunger, false, 1, "capStage3", "balanced");
    }
    expect(t.stage).toBeGreaterThan(h.stage);
  });

  it("caps at stage 3 (off), 5 (harsh), or 6/death (survival)", () => {
    const off = emptyTrackState();
    const harsh = emptyTrackState();
    const lethal = emptyTrackState();
    for (let i = 0; i < 20; i++) {
      advanceTrack(off, TRACKS.thirst, false, 1, "capStage3", "balanced");
      advanceTrack(harsh, TRACKS.thirst, false, 1, "climbHarsh", "balanced");
      advanceTrack(lethal, TRACKS.thirst, false, 1, "climbToDeath", "balanced");
    }
    expect(off.stage).toBe(3);
    expect(harsh.stage).toBe(5);
    expect(lethal.stage).toBe(6);
  });

  it("pace changes the fatal descent (4→6) but never stages 1–3", () => {
    const slow = emptyTrackState();
    const fast = emptyTrackState();
    // 4 deprived days at grace 1 → daysPastGrace 3: stage 3 in EVERY pace (offsets 1,2,3 shared).
    for (let i = 0; i < 4; i++) {
      advanceTrack(slow, TRACKS.thirst, false, 1, "climbToDeath", "slow");
      advanceTrack(fast, TRACKS.thirst, false, 1, "climbToDeath", "fast");
    }
    expect(slow.stage).toBe(3);
    expect(fast.stage).toBe(3);
    // Push further (10 deprived days total): fast reaches death well before slow.
    for (let i = 0; i < 6; i++) {
      advanceTrack(slow, TRACKS.thirst, false, 1, "climbToDeath", "slow");
      advanceTrack(fast, TRACKS.thirst, false, 1, "climbToDeath", "fast");
    }
    expect(fast.stage).toBeGreaterThan(slow.stage);
    expect(fast.stage).toBe(6);
  });

  it("blocks healing at hunger/thirst stage 3 but not cold", () => {
    const thirst = emptyTrackState();
    const cold = emptyTrackState();
    for (let i = 0; i < 6; i++) {
      advanceTrack(thirst, TRACKS.thirst, false, 1, "capStage3", "balanced");
      advanceTrack(cold, TRACKS.cold, false, 1, "capStage3", "balanced");
    }
    expect(thirst.stage).toBe(3);
    expect(thirst.blockedHealing).toBe(true);
    expect(cold.blockedHealing).toBe(false);
  });

  it("recovers: a satisfied day resets the counter and steps the stage down", () => {
    const st = emptyTrackState();
    for (let i = 0; i < 5; i++) advanceTrack(st, TRACKS.thirst, false, 1, "capStage3", "balanced");
    expect(st.stage).toBe(3);
    advanceTrack(st, TRACKS.thirst, true, 1, "capStage3", "balanced");
    expect(st.daysDeprived).toBe(0);
    expect(st.stage).toBe(2);
    expect(st.blockedHealing).toBe(false);
  });

  it("extreme cold accelerates the cold track by an extra stage step per night", () => {
    const slow = emptyTrackState();
    const fast = emptyTrackState();
    for (let i = 0; i < 2; i++) {
      advanceTrack(slow, TRACKS.cold, false, 1, "capStage3", "balanced", 0);
      advanceTrack(fast, TRACKS.cold, false, 1, "capStage3", "balanced", 1);
    }
    expect(fast.daysDeprived).toBeGreaterThan(slow.daysDeprived);
    expect(fast.stage).toBeGreaterThan(slow.stage);
  });

  it("recoverStep is a manual recovery step: stage down one, clock reset, healing unblocked", () => {
    const st = emptyTrackState();
    for (let i = 0; i < 6; i++) advanceTrack(st, TRACKS.thirst, false, 1, "capStage3", "balanced");
    expect(st.stage).toBe(3);
    expect(st.blockedHealing).toBe(true);
    recoverStep(st);
    expect(st.stage).toBe(2);
    expect(st.daysDeprived).toBe(0);
    expect(st.blockedHealing).toBe(false);
  });

  it("recoverStep never drops below stage 0", () => {
    const st = emptyTrackState();
    recoverStep(st);
    expect(st.stage).toBe(0);
  });
});
