import { describe, expect, it } from "vitest";
import { SETTINGS } from "../src/settings";

describe("settings registry", () => {
  const byKey = Object.fromEntries(SETTINGS.map((s) => [s.key, s]));

  it("ships the locked Shards defaults", () => {
    expect(byKey.supplyDetail.default).toBe("ledger"); // flipped 0.4.0: inventory counts by default
    expect(byKey.upkeepPrompt.default).toBe("onlyWhenWrong");
    expect(byKey.sourceMode.default).toBe("communalFirst");
    expect(byKey.climateModel.default).toBe("manual");
    expect(byKey.lethalDeprivation.default).toBe("capStage3");
    expect(byKey.splitPartyMode.default).toBe("single");
    expect(byKey.foraging.default).toBe(false);
    expect(byKey.maxCatchUpDays.default).toBe(14);
    expect(byKey.mountDefaultApplyConsequences.default).toBe(false);
  });

  it("has no duplicate keys", () => {
    const keys = SETTINGS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
