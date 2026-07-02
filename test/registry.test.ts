import { describe, expect, it } from "vitest";
import { emptyRegistry, normalizeRegistry } from "../src/state/registryData";

describe("registry normalization", () => {
  it("returns a sane default for empty/null input", () => {
    const reg = normalizeRegistry(null);
    expect(reg.groups).toEqual(["Main"]);
    expect(reg.climate.Main).toBe("temperate");
    expect(reg.members).toEqual([]);
    expect(reg.pools).toEqual([]);
    expect(reg.dataVersion).toBe(emptyRegistry().dataVersion);
  });

  it("fills pool defaults and preserves withParty", () => {
    const reg = normalizeRegistry({
      groups: ["Main"],
      pools: [{ id: "base", counts: { water: 5 }, withParty: { Main: true } } as any],
    });
    const base = reg.pools[0];
    expect(base.label).toBe("base");
    expect(base.counts).toEqual({ food: 0, water: 5, firewood: 0 });
    expect(base.isMount).toBe(false);
    expect(base.isStorage).toBe(false);
    expect(base.withParty).toEqual({ Main: true });
  });

  it("backfills actorUuid on a member's own pool (pre-0.2.0 registries) so Ledger can read it", () => {
    const reg = normalizeRegistry({
      members: [
        { uuid: "Actor.abc", poolId: "pack-1" } as any,
        { uuid: "Actor.def", poolId: "pack-2" } as any,
      ],
      pools: [
        { id: "pack-1", counts: {}, withParty: { Main: true } } as any, // old pool, no actorUuid
        { id: "pack-2", counts: {}, withParty: { Main: true }, actorUuid: "Actor.explicit" } as any,
      ],
    });
    expect(reg.pools[0].actorUuid).toBe("Actor.abc"); // backfilled from the member link
    expect(reg.pools[1].actorUuid).toBe("Actor.explicit"); // an explicit link is never overwritten
  });

  it("guarantees a climate band for every group", () => {
    const reg = normalizeRegistry({ groups: ["Main", "Delve"], climate: { Main: "hot" } });
    expect(reg.climate.Main).toBe("hot");
    expect(reg.climate.Delve).toBe("temperate");
  });

  it("defaults member flags and keeps an explicit needs override", () => {
    const reg = normalizeRegistry({
      members: [
        { uuid: "a" } as any,
        { uuid: "b", needsOverride: { food: 0 } } as any,
      ],
    });
    expect(reg.members[0]).toMatchObject({ uuid: "a", group: "Main", enabled: true, isMount: false, poolId: null });
    expect(reg.members[1].needsOverride).toEqual({ food: 0 });
  });
});
