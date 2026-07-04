import { describe, expect, it } from "vitest";
import { forBand } from "../src/core/climate";

describe("ClimateModel", () => {
  it("scales water by band: temperate ×1, hot ×2, extreme heat ×3", () => {
    expect(forBand("temperate").waterMult).toBe(1);
    expect(forBand("hot").waterMult).toBe(2);
    expect(forBand("extremeHeat").waterMult).toBe(3);
  });

  it("only extreme heat shortens thirst grace", () => {
    expect(forBand("extremeHeat").thirstGracePenalty).toBe(1);
    expect(forBand("hot").thirstGracePenalty).toBe(0);
    expect(forBand("extremeCold").thirstGracePenalty).toBe(0);
  });

  it("cold bands enable the cold track and demand firewood", () => {
    expect(forBand("temperate").cold).toBe(false);
    expect(forBand("cold").cold).toBe(true);
    expect(forBand("cold").bundles).toBe(3);
    expect(forBand("extremeCold").bundles).toBe(6);
    expect(forBand("extremeCold").coldStagePerNight).toBe(1);
  });
});
