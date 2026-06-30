import { computeTick, type Headline, type TickOptions, type TickResult } from "../core/engine";
import { type ActorState, type CaravanState, type ClimateBand, emptyActorState } from "../core/types";
import { MODULE_ID } from "../settings";
import type { SurvivalSystemAdapter } from "../systems/adapter";
import { type GroupView, projectGroups } from "./readModel";
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
  await applyConsequences(state, adapter);
  return result;
}

/** Apply each consumer's current stages as native conditions. Narrate-only mounts are skipped
 *  (a GM alert, no conditions on the NPC). The mapping + combined cap live in the adapter. */
async function applyConsequences(state: CaravanState, adapter: SurvivalSystemAdapter): Promise<void> {
  for (const c of state.consumers) {
    if (c.isMount && !c.applyConsequences) continue;
    const st = state.actorState[c.id];
    if (!st) continue;
    const actor = fromUuidSync(c.id);
    if (!actor) continue;
    await adapter.reconcileConsequences(actor, {
      hunger: st.hunger.stage,
      thirst: st.thirst.stage,
      cold: st.cold.stage,
    });
  }
}

/** Build the live engine snapshot from the registry + actors (read path; no writes). */
async function liveState(adapter: SurvivalSystemAdapter): Promise<CaravanState> {
  const registry = await CaravanRegistry.findOrCreate();
  const reg = registry.load();
  const facts = gatherFacts(reg, adapter);
  const actorStates = loadActorStates(reg);
  const lastTickDay = (game.settings.get(MODULE_ID, "lastTickDay") as number) ?? 0;
  return buildCaravanState(reg, facts, actorStates, lastTickDay);
}

/** The at-a-glance days-of-supply for a group, without advancing time. */
export async function readHeadline(adapter: SurvivalSystemAdapter, group = "Main"): Promise<Headline> {
  const state = await liveState(adapter);
  return computeTick(state, state.lastTickDay).headlineByGroup[group];
}

/** The full view-model every UI surface renders (no tick): headline, pools, roster + clocks. */
export async function readModel(adapter: SurvivalSystemAdapter): Promise<GroupView[]> {
  const state = await liveState(adapter);
  const headline = computeTick(state, state.lastTickDay).headlineByGroup;
  return projectGroups(state, headline);
}

// ---- GM mutations (GM-authoritative; the panel is GM-only so these run on the GM client) ----

export async function setWithParty(poolId: string, group: string, withParty: boolean): Promise<void> {
  const registry = await CaravanRegistry.findOrCreate();
  const reg = registry.load();
  const pool = reg.pools.find((p) => p.id === poolId);
  if (pool) {
    pool.withParty[group] = withParty;
    await registry.save(reg);
  }
}

export async function editPool(
  poolId: string,
  kind: "food" | "water" | "firewood",
  value: number,
): Promise<void> {
  const registry = await CaravanRegistry.findOrCreate();
  const reg = registry.load();
  const pool = reg.pools.find((p) => p.id === poolId);
  if (pool) {
    pool.counts[kind] = Math.max(0, Math.round(value));
    await registry.save(reg);
  }
}

export async function setClimate(group: string, band: ClimateBand): Promise<void> {
  const registry = await CaravanRegistry.findOrCreate();
  const reg = registry.load();
  reg.climate[group] = band;
  await registry.save(reg);
}

/** "Delving" preset: leave every pool/mount behind for the group; optionally set it underground. */
export async function applyDelvingPreset(group: string, setUnderground: boolean): Promise<void> {
  const registry = await CaravanRegistry.findOrCreate();
  const reg = registry.load();
  for (const p of reg.pools) p.withParty[group] = false;
  if (setUnderground) reg.climate[group] = "temperate";
  await registry.save(reg);
}

/** Advance N survival days from the current pointer (Advance Day = 1, Week = 7). */
export async function advanceDays(days: number, adapter: SurvivalSystemAdapter): Promise<TickResult> {
  const last = (game.settings.get(MODULE_ID, "lastTickDay") as number) ?? 0;
  return runTickViaFoundry(last + days, adapter);
}

/** Add an actor (by UUID) to the caravan as a consumer, with a personal/mount pool. Idempotent. */
export async function addActorToCaravan(
  uuid: string,
  opts: { isMount?: boolean; group?: string } = {},
): Promise<void> {
  const registry = await CaravanRegistry.findOrCreate();
  const reg = registry.load();
  if (reg.members.some((m) => m.uuid === uuid)) return;
  const group = opts.group ?? "Main";
  const isMount = !!opts.isMount;
  const poolId = isMount ? `mount-${uuid}` : `pack-${uuid}`;
  reg.members.push({ uuid, group, enabled: true, isMount, applyConsequences: false, poolId });
  if (!reg.pools.some((p) => p.id === poolId)) {
    reg.pools.push({
      id: poolId,
      label: isMount ? "Mount supply" : "Personal pack",
      counts: { food: 0, water: 0, firewood: 0 },
      withParty: { [group]: true },
      isMount,
      isStorage: isMount,
    });
  }
  await registry.save(reg);
}

/** Add the currently-selected canvas tokens to the caravan. Returns how many were added. */
export async function addSelectedTokens(): Promise<number> {
  const tokens = canvas?.tokens?.controlled ?? [];
  let n = 0;
  for (const t of tokens) {
    const actor = t.actor;
    if (!actor?.uuid) continue;
    await addActorToCaravan(actor.uuid, { isMount: !!actor.getFlag?.(MODULE_ID, "isMount") });
    n++;
  }
  return n;
}
