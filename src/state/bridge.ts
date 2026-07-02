import { computeTick, type Headline, type TickOptions, type TickResult } from "../core/engine";
import { forageYield } from "../core/foraging";
import { type ActorState, type CaravanState, type ClimateBand, type DegreeOfSuccess, emptyActorState } from "../core/types";
import { MODULE_ID } from "../settings";
import type { SurvivalSystemAdapter } from "../systems/adapter";
import { type GroupView, projectGroups } from "./readModel";
import { type RegistryData, type RegPool } from "./registryData";
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
      sizeName: adapter.getSizeName?.(actor) ?? null,
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
  const { registry, reg, state } = await loadLive(adapter);
  const pre = new Map(state.pools.map((p) => [p.id, { ...p.counts }]));
  const result = computeTick(state, targetDay, tickOptionsFromSettings());

  if (isLedger()) {
    // Decrement real items by exactly what the engine drew from each pool this tick.
    for (const p of state.pools) {
      const uuid = reg.pools.find((rp) => rp.id === p.id)?.actorUuid;
      const actor = uuid ? fromUuidSync(uuid) : null;
      if (!actor) continue;
      const before = pre.get(p.id)!;
      for (const kind of ["food", "water", "firewood"] as const) {
        const delta = before[kind] - p.counts[kind];
        if (delta > 0) await adapter.consume(actor, kind, delta);
      }
    }
  } else {
    writeBackPoolCounts(reg, state);
    await registry.save(reg);
  }

  await game.settings.set(MODULE_ID, "lastTickDay", state.lastTickDay);
  await persistActorStates(state);
  await applyConsequences(state, adapter);

  // Optional "next water in N days" desert countdown ticks down with the days that passed.
  const nextWater = (game.settings.get(MODULE_ID, "nextWaterDays") as number) ?? 0;
  if (nextWater > 0) {
    await game.settings.set(MODULE_ID, "nextWaterDays", Math.max(0, nextWater - result.daysProcessed));
  }
  return result;
}

/** Cook a hot meal for a group: burns 1 firewood from a with-party pool and applies the "well-fed"
 *  buff to each present eater. Returns the number buffed, -1 if no firewood, 0 if unsupported. */
export async function cookHotMeal(adapter: SurvivalSystemAdapter, group = "Main"): Promise<number> {
  if (!adapter.applyHotMeal) return 0;
  const registry = await CaravanRegistry.findOrCreate();
  const reg = registry.load();

  // Burn 1 firewood from a with-party pool — real items in Ledger mode, day-counts otherwise.
  let burned = false;
  for (const pool of reg.pools) {
    if (pool.withParty[group] !== true) continue;
    const actor = isLedger() && pool.actorUuid ? fromUuidSync(pool.actorUuid) : null;
    if (actor) {
      if (adapter.getAvailable(actor, "firewood") > 0) {
        await adapter.consume(actor, "firewood", 1);
        burned = true;
      }
    } else if (pool.counts.firewood > 0) {
      pool.counts.firewood -= 1;
      await registry.save(reg);
      burned = true;
    }
    if (burned) break;
  }
  if (!burned) return -1;

  let n = 0;
  for (const m of reg.members) {
    if (m.group !== group || !m.enabled || m.isMount) continue;
    const actor = fromUuidSync(m.uuid);
    if (!actor) continue;
    await adapter.applyHotMeal(actor);
    n++;
  }
  return n;
}

export interface ForageOutcome {
  degree: DegreeOfSuccess;
  food: number;
  fatigued: boolean;
}

/** Foraging / Subsist: roll the actor's Survival check via the adapter and credit the food gathered
 *  to a with-party pool (or the forager's own pack). Returns null if the system can't roll it. */
export async function forage(actorUuid: string, adapter: SurvivalSystemAdapter): Promise<ForageOutcome | null> {
  const actor = fromUuidSync(actorUuid);
  if (!actor || !adapter.rollForage) return null;
  const dc = (game.settings.get(MODULE_ID, "forageDC") as number) ?? 15;
  const degree = await adapter.rollForage(actor, dc);
  if (!degree) return null;

  const { food, fatigued } = forageYield(degree);
  if (food > 0) {
    const registry = await CaravanRegistry.findOrCreate();
    const reg = registry.load();
    const member = reg.members.find((m) => m.uuid === actorUuid);
    const group = member?.group ?? "Main";
    const target =
      reg.pools.find((p) => (p.isStorage || p.isMount) && p.withParty[group] === true) ??
      reg.pools.find((p) => p.id === member?.poolId);
    if (target) {
      const poolActor = isLedger() && target.actorUuid ? fromUuidSync(target.actorUuid) : null;
      if (poolActor) {
        await adapter.grant(poolActor, "food", food); // Ledger: credit real day-items
      } else {
        target.counts.food += food;
        await registry.save(reg);
      }
    }
  }
  return { degree, food, fatigued };
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

function isLedger(): boolean {
  return game.settings.get(MODULE_ID, "supplyDetail") === "ledger";
}

/** Load the registry + build the engine snapshot. In Ledger mode, each pool's counts are derived
 *  live from its backing actor's real inventory (via the adapter) rather than stored day-counts. */
async function loadLive(
  adapter: SurvivalSystemAdapter,
): Promise<{ registry: CaravanRegistry; reg: RegistryData; state: CaravanState }> {
  const registry = await CaravanRegistry.findOrCreate();
  const reg = registry.load();
  const facts = gatherFacts(reg, adapter);
  const actorStates = loadActorStates(reg);
  const lastTickDay = (game.settings.get(MODULE_ID, "lastTickDay") as number) ?? 0;
  const state = buildCaravanState(reg, facts, actorStates, lastTickDay);

  if (isLedger()) {
    for (const p of state.pools) {
      const uuid = reg.pools.find((rp) => rp.id === p.id)?.actorUuid;
      const actor = uuid ? fromUuidSync(uuid) : null;
      if (actor) {
        p.counts = {
          food: adapter.getAvailable(actor, "food"),
          water: adapter.getAvailable(actor, "water"),
          firewood: adapter.getAvailable(actor, "firewood"),
        };
      }
    }
  }

  // Derive friendly pool labels from the backing actor + role ("Grog (personal pack)",
  // "Chiga-Biga (shared stock)"). Display-only; the persisted label is left untouched.
  for (const p of state.pools) {
    const rp = reg.pools.find((x) => x.id === p.id);
    const actor = rp?.actorUuid ? fromUuidSync(rp.actorUuid) : null;
    const suffix = game.i18n.localize(p.isStorage ? "SURVIVAL.Pool.sharedStock" : "SURVIVAL.Pool.personalPack");
    if (actor?.name) p.label = `${actor.name} (${suffix})`;
    else if (p.isStorage) p.label = `${p.label} (${suffix})`;
  }
  return { registry, reg, state };
}

/** The live engine snapshot (read path; no writes). */
async function liveState(adapter: SurvivalSystemAdapter): Promise<CaravanState> {
  return (await loadLive(adapter)).state;
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
  adapter?: SurvivalSystemAdapter,
): Promise<void> {
  const registry = await CaravanRegistry.findOrCreate();
  const reg = registry.load();
  const pool = reg.pools.find((p) => p.id === poolId);
  if (!pool) return;
  const target = Math.max(0, Math.round(value));

  if (isLedger() && adapter && pool.actorUuid) {
    // Ledger: bring the actor's real inventory to the target (grant or consume the difference).
    const actor = fromUuidSync(pool.actorUuid);
    if (actor) {
      const current = adapter.getAvailable(actor, kind);
      if (target > current) await adapter.grant(actor, kind, target - current);
      else if (target < current) await adapter.consume(actor, kind, current - target);
    }
  } else {
    pool.counts[kind] = target;
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
      actorUuid: uuid,
    });
  }
  await registry.save(reg);
}

/** GM "reset": clear every member's hunger/thirst/cold tracks and strip the conditions the module
 *  applied. Supplies, pools, roster, and the day pointer are untouched. Returns creatures reset. */
export async function resetSurvival(adapter: SurvivalSystemAdapter, group?: string): Promise<number> {
  const registry = await CaravanRegistry.findOrCreate();
  const reg = registry.load();
  let n = 0;
  for (const m of reg.members) {
    if (group && m.group !== group) continue;
    const actor = fromUuidSync(m.uuid);
    if (!actor) continue;
    // Remove module-applied deprivation conditions (idempotent; also clears the `applied` flag).
    await adapter.reconcileConsequences(actor, { hunger: 0, thirst: 0, cold: 0 });
    if (actor.setFlag) await actor.setFlag(MODULE_ID, "state", emptyActorState());
    n++;
  }
  return n;
}

/** Party-member toggle: whether this creature consumes food/water (off = a structure or an
 *  inactive character; its pool keeps existing either way). */
export async function setMemberEnabled(uuid: string, enabled: boolean): Promise<void> {
  const registry = await CaravanRegistry.findOrCreate();
  const reg = registry.load();
  const m = reg.members.find((x) => x.uuid === uuid);
  if (!m) return;
  m.enabled = enabled;
  await registry.save(reg);
}

/** Remove a creature from survival tracking entirely (death, retired player). Drops the member
 *  and their own pool, strips module-applied conditions, and clears the tracking flags. */
export async function removeMemberFromCaravan(uuid: string, adapter?: SurvivalSystemAdapter): Promise<void> {
  const registry = await CaravanRegistry.findOrCreate();
  const reg = registry.load();
  const m = reg.members.find((x) => x.uuid === uuid);
  if (!m) return;
  reg.members = reg.members.filter((x) => x.uuid !== uuid);
  reg.pools = reg.pools.filter((p) => p.id !== m.poolId && p.actorUuid !== uuid);
  await registry.save(reg);

  const actor = fromUuidSync(uuid);
  if (actor) {
    if (adapter) await adapter.reconcileConsequences(actor, { hunger: 0, thirst: 0, cold: 0 });
    for (const flag of ["state", "applied", "isMount", "warmth"]) {
      await actor.unsetFlag?.(MODULE_ID, flag);
    }
  }
}

/** Remove a standalone base pool (a stockpile with no owning creature) from tracking. */
export async function removeBasePool(poolId: string): Promise<void> {
  const registry = await CaravanRegistry.findOrCreate();
  const reg = registry.load();
  reg.pools = reg.pools.filter((p) => p.id !== poolId);
  for (const m of reg.members) if (m.poolId === poolId) m.poolId = null;
  await registry.save(reg);
}

/** Deliberate sharing (never automatic): move up to `amount` of `kind` from one pool to another.
 *  In Ledger mode actor-backed ends move REAL items (consume/grant); day-count pools adjust counts.
 *  Returns the amount actually moved. */
export async function transferSupply(
  fromPoolId: string,
  toPoolId: string,
  kind: "food" | "water" | "firewood",
  amount: number,
  adapter?: SurvivalSystemAdapter,
): Promise<number> {
  const registry = await CaravanRegistry.findOrCreate();
  const reg = registry.load();
  const from = reg.pools.find((p) => p.id === fromPoolId);
  const to = reg.pools.find((p) => p.id === toPoolId);
  const want = Math.max(0, Math.floor(amount));
  if (!from || !to || from === to || want === 0) return 0;

  const actorOf = (p: RegPool) => (isLedger() && p.actorUuid ? fromUuidSync(p.actorUuid) : null);

  const srcActor = actorOf(from);
  let moved: number;
  if (srcActor && adapter) {
    moved = await adapter.consume(srcActor, kind, want);
  } else {
    moved = Math.min(from.counts[kind], want);
    from.counts[kind] -= moved;
  }

  if (moved > 0) {
    const dstActor = actorOf(to);
    if (dstActor && adapter) await adapter.grant(dstActor, kind, moved);
    else to.counts[kind] += moved;
  }
  await registry.save(reg);
  return moved;
}

/** Promote/demote a member between a plain party member and a mount. A mount's own pool becomes
 *  SHARED STOCK the whole party draws from (a mobile base); demoting reverts it to a personal pack. */
export async function setMemberRole(uuid: string, isMount: boolean): Promise<void> {
  const registry = await CaravanRegistry.findOrCreate();
  const reg = registry.load();
  const m = reg.members.find((x) => x.uuid === uuid);
  if (!m) return;
  m.isMount = isMount;
  let pool =
    reg.pools.find((p) => p.actorUuid === uuid) ?? (m.poolId ? reg.pools.find((p) => p.id === m.poolId) : undefined);
  if (!pool && isMount) {
    const id = m.poolId ?? `mount-${uuid}`;
    pool = {
      id, label: "Mount supply", counts: { food: 0, water: 0, firewood: 0 },
      withParty: { [m.group]: true }, isMount: true, isStorage: true, actorUuid: uuid,
    };
    reg.pools.push(pool);
    m.poolId = id;
  }
  if (pool) {
    pool.isMount = isMount;
    pool.isStorage = isMount; // a mount carries shared stock; a member keeps a personal pack
  }
  const actor = fromUuidSync(uuid);
  await actor?.setFlag?.(MODULE_ID, "isMount", isMount);
  await registry.save(reg);
}

/** Add a standalone base: a communal stockpile pool (no creature) the party draws from and can
 *  leave behind via the separation toggle. Its counts are edited by hand (Abstract). */
export async function addBasePool(label: string, group = "Main"): Promise<void> {
  const registry = await CaravanRegistry.findOrCreate();
  const reg = registry.load();
  reg.pools.push({
    id: `base-${foundry.utils.randomID()}`,
    label: label || "Base",
    counts: { food: 0, water: 0, firewood: 0 },
    withParty: { [group]: true },
    isMount: false,
    isStorage: true,
  });
  await registry.save(reg);
}

/** One-shot 0.4.1 heal: worlds that stored Abstract explicitly but never actually used it
 *  (every pool count is zero) are switched to Ledger — the mode the 0.4.x default intends,
 *  so real inventory (rations, waterskins) counts. Returns true if the mode was flipped. */
export async function migrateAbstractToLedger(): Promise<boolean> {
  if (game.settings.get(MODULE_ID, "supplyDetail") !== "abstract") return false;
  const uuid = game.settings.get(MODULE_ID, "caravanDocUuid") as string;
  if (!uuid) return false; // fresh world — the default is already Ledger
  const registry = await CaravanRegistry.findOrCreate();
  const reg = registry.load();
  if (!reg.pools.length) return false;
  const allZero = reg.pools.every(
    (p) => p.counts.food === 0 && p.counts.water === 0 && p.counts.firewood === 0,
  );
  if (!allZero) return false; // typed counts exist — Abstract is genuinely in use, leave it
  await game.settings.set(MODULE_ID, "supplyDetail", "ledger");
  return true;
}

/** Console diagnostic (api.diagnose()): the supply mode, each pool's actor resolution + live
 *  counts, and how every inventory item was classified — so "why is it 0" is answerable. */
export async function diagnoseSurvival(adapter: SurvivalSystemAdapter): Promise<string> {
  const registry = await CaravanRegistry.findOrCreate();
  const reg = registry.load();
  const ledger = isLedger();
  const lines: string[] = [
    `supply mode: ${game.settings.get(MODULE_ID, "supplyDetail")} | system adapter: ${adapter.systemId}`,
  ];
  for (const p of reg.pools) {
    const actor = p.actorUuid ? fromUuidSync(p.actorUuid) : null;
    const link = p.actorUuid
      ? actor
        ? `actor OK (${actor.name})`
        : `actor MISSING (${p.actorUuid})`
      : "no actor (manual counts)";
    const counts =
      actor && ledger
        ? `live: food ${adapter.getAvailable(actor, "food")} · water ${adapter.getAvailable(actor, "water")} · wood ${adapter.getAvailable(actor, "firewood")}`
        : `stored: food ${p.counts.food} · water ${p.counts.water} · wood ${p.counts.firewood}`;
    lines.push(`pool "${p.label}" [${p.id}] — ${link} — ${counts}`);
    if (actor && adapter.diagnoseActor) for (const l of adapter.diagnoseActor(actor)) lines.push(`    ${l}`);
  }
  const text = lines.join("\n");
  console.log(`${MODULE_ID} | diagnose\n${text}`);
  return text;
}

/** GM-side write of a creature's "kept warm tonight" flag (called via socketlib from a player). */
export async function setWarm(actorUuid: string, warm: boolean): Promise<void> {
  const actor = fromUuidSync(actorUuid);
  if (actor?.setFlag) await actor.setFlag(MODULE_ID, "warmth", warm);
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
