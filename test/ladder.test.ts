import { describe, expect, it } from "vitest";
import { advanceTrack, TRACKS } from "../src/core/ladder";
import { emptyTrackState } from "../src/core/types";

describe("LadderEngine", () => {
  it("respects the grace window before any stage", () => {
    const st = emptyTrackState();
    // thirst grace 1: day 1 deprived is still within grace, day 2 tips to stage 1
    advanceTrack(st, TRACKS.thirst, false, 1, "capStage3");
    expect(st.stage).toBe(0);
    advanceTrack(st, TRACKS.thirst, false, 1, "capStage3");
    expect(st.stage).toBe(1);
  });

  it("escalates thirst faster than hunger", () => {
    const t = emptyTrackState();
    const h = emptyTrackState();
    for (let i = 0; i < 4; i++) {
      advanceTrack(t, TRACKS.thirst, false, 1, "capStage3");
      advanceTrack(h, TRACKS.hunger, false, 1, "capStage3");
    }
    expect(t.stage).toBeGreaterThan(h.stage);
  });

  it("caps at stage 3 by default and reaches 4 only when climbing to death", () => {
    const capped = emptyTrackState();
    const lethal = emptyTrackState();
    for (let i = 0; i < 20; i++) {
      advanceTrack(capped, TRACKS.thirst, false, 1, "capStage3");
      advanceTrack(lethal, TRACKS.thirst, false, 1, "climbToDeath");
    }
    expect(capped.stage).toBe(3);
    expect(lethal.stage).toBe(4);
  });

  it("blocks healing at hunger/thirst stage 3 but not cold", () => {
    const thirst = emptyTrackState();
    const cold = emptyTrackState();
    for (let i = 0; i < 6; i++) {
      advanceTrack(thirst, TRACKS.thirst, false, 1, "capStage3");
      advanceTrack(cold, TRACKS.cold, false, 1, "capStage3");
    }
    expect(thirst.stage).toBe(3);
    expect(thirst.blockedHealing).toBe(true);
    expect(cold.blockedHealing).toBe(false);
  });

  it("recovers: a satisfied day resets the counter and steps the stage down", () => {
    const st = emptyTrackState();
    for (let i = 0; i < 5; i++) advanceTrack(st, TRACKS.thirst, false, 1, "capStage3");
    expect(st.stage).toBe(3);
    advanceTrack(st, TRACKS.thirst, true, 1, "capStage3");
    expect(st.daysDeprived).toBe(0);
    expect(st.stage).toBe(2);
    expect(st.blockedHealing).toBe(false);
  });

  it("extreme cold accelerates the cold track by an extra stage step per night", () => {
    const slow = emptyTrackState();
    const fast = emptyTrackState();
    for (let i = 0; i < 2; i++) {
      advanceTrack(slow, TRACKS.cold, false, 1, "capStage3", 0);
      advanceTrack(fast, TRACKS.cold, false, 1, "capStage3", 1);
    }
    expect(fast.daysDeprived).toBeGreaterThan(slow.daysDeprived);
    expect(fast.stage).toBeGreaterThan(slow.stage);
  });
});
