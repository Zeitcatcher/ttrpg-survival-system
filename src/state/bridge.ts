import { computeTick, type Headline, type TickOptions, type TickResult } from "../core/engine";
import { type ActorState, emptyActorState } from "../core/types";
import { MODULE_ID } from "../settings";
import type { SurvivalSystemAdapter } from "../systems/adapter";
import { type RegistryData } from "./registryData";
import { CaravanRegistry } from "./registryDoc";
import { type ActorFacts, buildCaravanState, writeBackPoolCounts } from "./snapshot";

// The Foundry orchestration layer: gather system facts via the adapter, build the engine
// snapshot, run the pure tick, then persist pool counts + per-actor state. GM-authoritative.
//
// NOTE: this layer is typechecked but exercised in a live world (it reads/writes Actors and
// documents) — smoke-tested in Foundry, not Vitest. The logic it delegates to (engine + snapshot)
// is fully unit-tested.

function tickOptionsFromSettings(): Partial<TickOptions> {
  return {
    sourceMode: game.settings.get(MODULE_ID, "sourceMode"),
    lethal: game.settings.get(MODULE_ID, "lethalDeprivation"),
    maxCatchUpDays: game.settings.get(MODULE_ID, "maxCatchUpDays"),
  };
}

function gatherFacts(reg: RegistryData, adapter: SurvivalSystemAdapter): Record<string, ActorFacts> {
  const facts: Record<string, ActorFacts> = {};
  for (const m of reg.members) {
    const actor = fromUuidSync(m.uuid);
    if (!actor) continue; // dangling UUID — dropped (the snapshot builder skips it)
    facts[m.uuid] = {
      name: actor.name ?? m.uuid,
      sizeMult: adapter.getSizeMult(actor),
      ration: adapter.getCreatureRation(actor),
      graceDays: {
        hunger: adapter.getGraceDays(actor, "hunger"),
        thirst: adapter.getGraceDays(actor, "thirst"),
        cold: adapter.getGraceDays(actor, "cold"),
      },
      needsConsumption: adapter.needsConsumption(actor),
      warmAuto: adapter.isWarmSourceEquipped(actor),
      keptWarm: !!actor.getFlag?.(MODULE_ID, "warmth"),
    };
  }
  return facts;
}

function loadActorStates(reg: RegistryData): Record<string, ActorState> {
  const out: Record<string, ActorState> = {};
  for (const m of reg.members) {
    const actor = fromUuidSync(m.uuid);
    out[m.uuid] = actor?.getFlag?.(MODULE_ID, "state") ?? emptyActorState();
  }
  return out;
}

async function persistActorStates(
  state: { consumers: { id: string }[]; actorState: Record<string, ActorState> },
): Promise<void> {
  for (const c of state.consumers) {
    const actor = fromUuidSync(c.id);
    if (actor?.setFlag) await actor.setFlag(MODULE_ID, "state", state.actorState[c.id]);
  }
}

/** Advance survival to `targetDay`, persisting the result. The single GM-side entry point that
 *  the world-clock hook, Rest, and the Advance control will all call. */
export async function runTickViaFoundry(
  targetDay: number,
  adapter: SurvivalSystemAdapter,
): Promise<TickResult> {
  const registry = await CaravanRegistry.findOrCreate();
  const reg = registry.load();
  const facts = gatherFacts(reg, adapter);
  const actorStates = loadActorStates(reg);
  const lastTickDay = (game.settings.get(MODULE_ID, "lastTickDay") as number) ?? 0;

  const state = buildCaravanState(reg, facts, actorStates, lastTickDay);
  const result = computeTick(state, targetDay, tickOptionsFromSettings());

  writeBackPoolCounts(reg, state);
  await registry.save(reg);
  await game.settings.set(MODULE_ID, "lastTickDay", state.lastTickDay);
  await persistActorStates(state);
  // M3: per consumer, adapter.reconcileConsequences(actor, {hunger,thirst,cold stages})
  //     to apply native conditions; mounts with applyConsequences=false stay narrate-only.
  return result;
}

/** The at-a-glance days-of-supply for a group, without advancing time. */
export async function readHeadline(adapter: SurvivalSystemAdapter, group = "Main"): Promise<Headline> {
  const registry = await CaravanRegistry.findOrCreate();
  const reg = registry.load();
  const facts = gatherFacts(reg, adapter);
  const actorStates = loadActorStates(reg);
  const lastTickDay = (game.settings.get(MODULE_ID, "lastTickDay") as number) ?? 0;
  const state = buildCaravanState(reg, facts, actorStates, lastTickDay);
  return computeTick(state, lastTickDay).headlineByGroup[group];
}
