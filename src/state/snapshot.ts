import type { ActorState, CaravanState, Consumer, TrackKey } from "../core/types";
import { emptyActorState } from "../core/types";
import type { RegistryData } from "./registryData";

// System facts the adapter reads off one actor (Con-mod grace, size, ration, warmth…).
// Plain data, so the snapshot builder is pure and testable with a fake facts map.
export interface ActorFacts {
  name: string;
  sizeMult: number;
  /** Display name of the size trait ("Gargantuan"); null = unknown. */
  sizeName?: string | null;
  ration: { food: number; water: number };
  graceDays: Record<TrackKey, number>;
  needsConsumption: boolean;
  warmAuto: boolean;
  keptWarm: boolean;
}

/** Assemble the engine's mutable snapshot from the persisted registry, the per-actor system
 *  facts (gathered via the adapter), and the prior per-actor survival state (from actor flags). */
export function buildCaravanState(
  reg: RegistryData,
  facts: Record<string, ActorFacts>,
  actorStates: Record<string, ActorState>,
  lastTickDay: number,
): CaravanState {
  const consumers: Consumer[] = reg.members
    .filter((m) => facts[m.uuid] !== undefined)
    .map((m) => {
      const f = facts[m.uuid];
      return {
        id: m.uuid,
        name: f.name,
        group: m.group,
        sizeMult: f.sizeMult,
        sizeName: f.sizeName ?? null,
        ration: {
          food: m.needsOverride?.food ?? f.ration.food,
          water: m.needsOverride?.water ?? f.ration.water,
        },
        graceDays: f.graceDays,
        isMount: m.isMount,
        applyConsequences: m.applyConsequences,
        enabled: m.enabled,
        needsConsumption: f.needsConsumption,
        poolId: m.poolId,
        keptWarm: f.keptWarm,
        warmAuto: f.warmAuto,
      };
    });

  const pools = reg.pools.map((p) => ({ ...p, counts: { ...p.counts }, withParty: { ...p.withParty } }));

  const state: CaravanState = {
    groups: [...reg.groups],
    climate: { ...reg.climate },
    consumers,
    pools,
    actorState: {},
    lastTickDay,
  };
  for (const c of consumers) {
    state.actorState[c.id] = actorStates[c.id] ? cloneState(actorStates[c.id]) : emptyActorState();
  }
  return state;
}

/** After a tick, copy the engine's pool counts back into the registry for persistence. */
export function writeBackPoolCounts(reg: RegistryData, state: CaravanState): void {
  const byId = new Map(state.pools.map((p) => [p.id, p]));
  for (const p of reg.pools) {
    const updated = byId.get(p.id);
    if (updated) p.counts = { ...updated.counts };
  }
}

function cloneState(s: ActorState): ActorState {
  return {
    hunger: { ...s.hunger },
    thirst: { ...s.thirst },
    cold: { ...s.cold },
  };
}
