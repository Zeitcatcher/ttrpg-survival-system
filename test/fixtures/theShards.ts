import type { CaravanState, Consumer, Pool } from "../../src/core/types";

// The Shards party as a plain engine snapshot, for headless tests.
// Climate: desert (Hot, water ×2). Chiga-Biga is the mount + base + only stockpile (Gargantuan ×8).
// Each PC carries a personal waterskin (2 Water) — Грог's is empty, so he's the first to go dry.
// (B.9: Abstract v1 seeds personal pools so the canonical Ssir-Kat beat is reproducible.)

function pc(id: string, name: string, thirstGrace: number): Consumer {
  return {
    id, name, group: "Main", sizeMult: 1, sizeName: "Medium",
    ration: { food: 1, water: 1 },
    graceDays: { hunger: 3, thirst: thirstGrace, cold: 3 },
    isMount: false, applyConsequences: false, enabled: true, needsConsumption: true,
    poolId: `pack-${id}`, keptWarm: false, warmAuto: false,
  };
}

function pack(id: string, water: number): Pool {
  return {
    id: `pack-${id}`, label: `${id} pack`,
    counts: { food: 0, water, firewood: 0 },
    withParty: { Main: true }, isMount: false, isStorage: false,
  };
}

export function buildShardsState(): CaravanState {
  const consumers: Consumer[] = [
    pc("irime", "Иримэ", 3),
    pc("vestnik", "Вестник", 2),
    pc("rakakak", "Ракакак", 2),
    pc("grog", "Грог", 1),
    pc("aranea", "Аранэя", 2),
    {
      id: "chiga", name: "Chiga-Biga", group: "Main", sizeMult: 8, sizeName: "Gargantuan",
      ration: { food: 1, water: 1 },
      graceDays: { hunger: 3, thirst: 3, cold: 3 },
      isMount: true, applyConsequences: false, enabled: true, needsConsumption: true,
      poolId: "chiga", keptWarm: false, warmAuto: false,
    },
    {
      id: "staf", name: "Staf", group: "Main", sizeMult: 1, sizeName: "Medium",
      ration: { food: 1, water: 1 },
      graceDays: { hunger: 3, thirst: 2, cold: 3 },
      isMount: false, applyConsequences: false, enabled: true, needsConsumption: true,
      poolId: null, keptWarm: false, warmAuto: false,
    },
    ...["kvizzl", "svirp", "ving"].map((id, i): Consumer => ({
      id, name: ["Квиззл", "Свирп", "Винг"][i], group: "Main", sizeMult: 1, sizeName: "Small",
      ration: { food: 0, water: 0 },
      graceDays: { hunger: 3, thirst: 3, cold: 3 },
      isMount: false, applyConsequences: false, enabled: true, needsConsumption: true,
      poolId: null, keptWarm: false, warmAuto: false,
    })),
  ];

  const pools: Pool[] = [
    {
      // Group need in the heat: (5 PCs + Staf + Chiga ×8) = 14 food, 28 water per day —
      // this stockpile covers ~1 day of water with the base present, 0 without it (the cliff).
      id: "chiga", label: "Chiga-Biga (base)",
      counts: { food: 30, water: 30, firewood: 4 },
      withParty: { Main: true }, isMount: true, isStorage: true,
    },
    pack("irime", 2),
    pack("vestnik", 2),
    pack("rakakak", 2),
    pack("grog", 0), // Грог's waterskin is empty
    pack("aranea", 2),
  ];

  return {
    groups: ["Main"],
    climate: { Main: "hot" },
    consumers,
    pools,
    actorState: {},
    lastTickDay: 0,
  };
}
