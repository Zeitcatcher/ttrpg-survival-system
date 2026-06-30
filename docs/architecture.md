# Technical Architecture — Draft (step 2)

> **Status: PRELIMINARY.** This is the **step-2** layer. It's provided so you can see the technical direction and judge that the system-agnostic / localization goals are achievable — but it will be finalized *after* the [mechanics](survival-mechanics.md) are approved, since mechanics changes can ripple here. Read for direction, not for sign-off.
>
> **Module id:** `shards-survival` · **Stack:** TypeScript + Vite · **i18n:** English default, locale-ready from day one.

**Platform reconciliation:** your saved environment targets **Foundry v14.364 + pf2e v8.2.0**. The architecture targets `minimum: 13`, `verified: 14`, **no `maximum`** (a `maximum` would lock players out of future Foundry with no override). On v13+/v14 the sheet/app layer is fully ApplicationV2, which removes the v12-era pf2e-sheet caveats an earlier draft worried about.

---

## 0. Pillars (non-negotiables)

1. **Core never names a system.** The string `"pf2e"` lives only inside `src/systems/`. A lint rule bans `game.system.id` outside that folder.
2. **One write authority.** Every shared-state mutation runs on the **primary GM client**; players round-trip through `socketlib.executeAsGM`.
3. **One day code path.** World-clock crossing, Rest, and the "Advance a Day" button all converge on `SurvivalEngine.runTick()`.
4. **Separation enforced at the sourcing layer**, never the UI — a separated pool is removed from the allocation list *before* allocation.
5. **Native conditions over bespoke effects** — the adapter maps each ladder stage to the host system's real condition vocabulary.

---

## 1. Layers

```
UI (ApplicationV2):  GmControlPanel · PartyHud · UpkeepDialog · sheet-injections
Orchestration:       time.ts (day boundary) · socket.ts (executeAsGM) · settings.ts (the dials)
CORE (system-neutral): SurvivalEngine · Resolver · LadderEngine · ClimateModel · Caravan store · migrations
Adapter seam:        interface SurvivalSystemAdapter  →  Pf2eAdapter | Dnd5eAdapter | GenericAdapter
Foundry:             Actor · Item · ActiveEffect · settings · sockets · i18n
```

Dependencies point downward only. Core imports the adapter *interface*, never a concrete adapter.

## 1.1 The adapter contract (revised)

Core needs the adapter for exactly four irreducible things: **read** resources, **decrement** resources, **reconcile** consequences, and **classify/inspect** actors. Everything else (timing, ladders, climate, allocation) is system-neutral core.

```ts
export type ResourceKind = "food" | "water" | "firewood";
export type TrackKey = "hunger" | "thirst" | "cold";
export type DegreeOfSuccess = "critFail" | "fail" | "success" | "critSuccess";

export interface SurvivalSystemAdapter {
  readonly systemId: string;

  // INVENTORY (read) — normalized to creature-days / bundles; honors a per-item override flag first
  getResourceLots(actor: Actor, kind: ResourceKind): ResourceLot[];
  getAvailable(actor: Actor, kind: ResourceKind): number;

  // INVENTORY (write) — handles the 7-ration decomposition + per-system quantity path; batched
  consume(actor: Actor, kind: ResourceKind, units: number): Promise<number>; // returns amount actually consumed
  grant(actor: Actor, kind: ResourceKind, units: number): Promise<void>;

  // CREATURE NEEDS / LIVENESS
  getCreatureRation(actor: Actor): { food: number; water: number };
  getGraceDays(actor: Actor, track: TrackKey): number;        // pf2e: Con-mod + 1
  isMount(actor: Actor): boolean;
  needsConsumption(actor: Actor): boolean;                    // false for dead / HP0-dying / "doesn't eat"

  // CONSEQUENCES — ONE idempotent reconcile over ALL tracks (see §1.2)
  reconcileConsequences(actor: Actor, stages: Record<TrackKey, number>): Promise<void>;

  // WARMTH
  isWarmSourceEquipped(actor: Actor): boolean;               // pf2e Cold-Weather Clothing → pre-tick warmth

  // FORAGING (optional extra)
  rollForage?(actor: Actor, dc: number): Promise<DegreeOfSuccess | null>;
}
```

**Why `reconcileConsequences(actor, allTracks)` and not per-track `applyStage`** (the most important fix from review): a per-track call bakes in PF2e's *independent multi-condition* model. dnd5e's sink is a **single 0–6 Exhaustion scalar** that all three tracks collapse onto — so the adapter must see all tracks at once to compute the aggregate. A single reconcile call also fixes the **shared-`Fatigued` bug**: hunger, thirst, and cold all want Fatigued at Stage 1, but it's one non-stacking flag — recovering one track must not strip a condition the other two still demand. The adapter computes the **union** of demanded conditions and diffs to it. pf2e diffs to native conditions via a declarative `STAGE_MAP`; generic uses module ActiveEffects tagged `flags["shards-survival"].track`; dnd5e maps the aggregate to one Exhaustion value (and branches 2014 vs 2024 on `game.system.version`).

> Honest caveat: for dnd5e this **replaces** the SRD's save-based survival rules with our deterministic ladder, rather than honoring them. That's a deliberate design choice (we impose one consistent survival model across systems), and it should be stated in the 5e adapter's docs.

## 1.2 PF2e stage map (lives in the adapter, not core)

```ts
const STAGE_MAP: Record<TrackKey, Record<number, Pf2eConditionSpec[]>> = {
  hunger: { 1:[{slug:"fatigued"}], 2:[{slug:"enfeebled",value:1}], 3:[{slug:"drained",value:1}], 4:[{slug:"drained",value:2},{slug:"doomed",value:1}] },
  thirst: { 1:[{slug:"fatigued"}], 2:[{slug:"sickened",value:1}], 3:[{slug:"drained",value:1}], 4:[{slug:"drained",value:2},{slug:"doomed",value:1}] },
  cold:   { 1:[{slug:"fatigued"}], 2:[{slug:"clumsy",value:1}],   3:[{slug:"clumsy",value:2},{slug:"drained",value:1}], 4:[{slug:"drained",value:2},{slug:"doomed",value:1}] },
};
// reconcileConsequences computes the UNION of all active tracks' specs, diffs against the actor's
// currently module-applied conditions, and calls increaseCondition/decreaseCondition to reach it.
// Provenance: it only ever touches conditions IT applied — never strips a Doomed from a curse/crit.
```

The **combined-cap** mechanic from the spec (never more than Fatigued + one other) is applied in core *before* calling reconcile, by clamping the demanded set.

---

## 2. Data model

### 2.1 Where state lives

| State | Storage | Why |
|---|---|---|
| **The Caravan registry** (members, storage, mounts, each `withParty` per group, group tags, per-group climate) | a **dedicated "Caravan" document** (an Actor or JournalEntry), holding the registry in its flags | A pool spans many actors + storage + mounts — no natural owning doc. A *document* (not a world-setting blob) gives **atomic, queued `update()`** and a free `updateDocument` re-render hook — sidestepping the read-modify-write race a single settings-blob would suffer when the tick, a panel edit, and a socket call collide. Stores **UUID references**, never embedded actors. |
| **Storage stockpiles / each mount's contents** | a **real Actor**, referenced by UUID | Reusing an Actor gives a sheet, inventory, permissions, and Bulk for free. Chiga-Biga = one actor that is both mount and storage → one UUID, one toggle. |
| **Per-actor survival counters** (per-track `daysDeprived` + `stage`, `blockedHealing`, `joinedDay`) | `actor.flags["shards-survival"].state` | Travels with the actor across scenes and **campaigns** (the vault is reused). |
| **"Kept warm tonight"** | `actor.flags["shards-survival"].warmth` — a **separate key** | Must be its own key so a player's owner-write doesn't get clobbered by the GM's wholesale `state` write (or vice-versa). |
| **The dials + thresholds + climate presets + item-match lists + locale-independent config** | **world settings** | Standard config surface; a `registerMenu` opens the richer config app. |
| **UI prefs** (panel collapsed, HUD density) | **client setting** | Never write the world DB for view state. |

### 2.2 Registry shape (sketch)

```ts
interface CaravanStore {
  dataVersion: number;
  groups: GroupTag[];                                 // ["Main", "Delve", ...]
  climate: Record<GroupTag, ClimateBand>;             // PER-GROUP (a delve underground ≠ the surface desert)
  members: MemberRef[];                               // PCs / NPC consumers
  storage: PoolRef[];
  mounts:  MountRef[];                                // both consumer AND pool
}
interface PoolRef { uuid: string; withParty: Record<GroupTag, boolean>; label: string; }
interface MemberRef { uuid: string; group: GroupTag; enabled: boolean; joinedDay: number;
                      needsOverride?: Partial<{food:number; water:number}>; }
interface MountRef extends PoolRef {
  consumes: { food:number; water:number } | "offBooks";  // default "offBooks" (pool-only)
  applyConsequences: boolean;                             // default false (narrate, don't auto-condition)
  isStorage: boolean; handlerUuid?: string;
}
type ClimateBand = "temperate"|"hot"|"extremeHeat"|"cold"|"extremeCold";
type GroupTag = string;
```

`withParty[group] === false` ⇒ the resolver filters that pool out **before** allocation. The "Delving" preset sets every pool's `withParty[*] = false` in one atomic document update. A missing `withParty[newGroup]` key defaults to **`false` and surfaces a "assign this pool" prompt** (fail-loud, never silent-starve).

---

## 3. The daily tick

### 3.1 Triggers → one method (decoupled from world-time)
- **World clock crossing** → `updateWorldTime` hook does the day-boundary math, then calls `runTick(targetDay)`.
- **Rest-for-the-Night** and the **"Advance a Day" button** → call `runTick(currentDay + 1)` **directly**. They do *not* go through `game.time.advance()` — PF2e's Rest advances a system-computed duration (often 8h, configurable) and conflating "a survival day passed" with "world time advanced 86400s" is what creates double-advance bugs against a calendar module. All three converge on `runTick`; only the clock hook does boundary arithmetic.

### 3.2 `runTick(targetDay)` — day-interleaved, transactional, GM-only

```
guard: isPrimaryGM() AND acquire a world-backed re-entrancy lock (serialize concurrent triggers)
load registry + dials + adapter
for each pending day d in (lastTickDay+1 .. min(targetDay, lastTickDay+maxCatchUpDays)):   // catch-up
  for each GROUP:
     presentPools     = pools/mounts where withParty[group] === true        // SEPARATION FILTER
     presentConsumers = members in group where enabled && needsConsumption(actor) && joinedDay <= d
     climate          = ClimateModel.forBand(store.climate[group])
     ledger           = new AllocationLedger(presentPools)                   // in-memory working copy
     for each consumer: allocate food/water down the source order, DECREMENTING the ledger immediately
        → record shortfall (with named cause) only after the WHOLE chain is dry
     resolve firewood-for-warmth (whole camp; warmth strictly before any cooking extra)
     LadderEngine.advanceOrClear(per actor): satisfied → reset counter & step stage toward 0;
                                             deprived  → increment counter, recompute stage (capped)
  batch-commit: net per-lot inventory deltas + per-actor flag writes + reconcileConsequences(union)
  record lastTickDay = d (committed per-day, so a GM hand-off mid-loop resumes correctly)
emit ONE whispered summary per group (named-cause shortfalls + visible per-character clocks)
if Dial3 == "only when wrong" AND all green: silent whisper, no dialog; else open UpkeepDialog (one Confirm)
release lock
```

**Correctness invariants** (each a property test):
- **Transactional allocation** — `AllocationLedger` decrements a working copy as each consumer draws, so two consumers can never both be told the full pool is available (no double-spend). Sum of draws ≤ initial availability, always.
- **Day-interleaved** — consumption *and* ladder advance run inside the per-day loop, so a 6-day jump that goes dry on day 4 escalates correctly (reaches Wasting, not Hungry).
- **Single idempotency pointer** — one global `lastTickDay`; late arrivals use `joinedDay` instead of a parallel per-actor pointer (the two-pointer design desynced on rewind).
- **Rewind** = a backward clock move sets the pointer back without refunding consumed items, and a **large backward jump prompts "new campaign? reset survival tracking?"** (the cross-campaign clock-reset trap — real, given vault reuse).
- **Catch-up cap** (`maxCatchUpDays`, default 14) — on overflow, *ask* the GM: process the cap as a montage, or apply a lump deprivation summary. Never silently under-charge.
- **Re-entrancy lock** — world-state-backed, so the Rest hook and the world-time hook can't both enter `runTick` for the same day.
- **Dangling UUID resilience** — a pool whose actor no longer resolves (the mount died) is skipped with *"its supplies are lost"* + a GM cargo-disposition prompt — never a crash.

---

## 4. UI (ApplicationV2)

Four surfaces, all `HandlebarsApplicationMixin(ApplicationV2)`:
- **GmControlPanel** (GM): the headline readout, per-pool `With party?` toggles + the Delving preset, the roster (per-consumer status, **visible clocks**, needs override, a red "no reachable supply" badge for mis-configured consumers), and the climate picker. Click-a-number pool edits commit on **blur/Enter** (not per-keystroke).
- **PartyHud** (players, read-mostly): pool headline + per-PC track icons + each player's own **"Kept warm tonight?"** checkbox. Separated pools render greyed with a tag.
- **UpkeepDialog**: the single daily card (need vs available vs source, named-cause shortfalls, firewood row only when relevant, one Confirm). Split parties = **one card, two sections** — never two dialogs.
- **Sheet injection** via `renderActorSheetV2` / `renderItemSheetV2`: a "Kept warm" checkbox on PCs and a "Survival resource: food/water/firewood" dropdown on item sheets (the homebrew escape hatch — sets the per-item override flag the adapter reads first). Applied conditions already show as native HUD icons — no parallel status widget.

All player actions route through `socketlib.executeAsGM` (uniform, correct — no "direct owner-write" special case to clobber state); each call is awaited and its "no GM online" rejection is caught and surfaced.

---

## 5. Localization

- **Manifest** lists `en` (default) + `ru` (your table is bilingual). Foundry merges lang files and picks the one matching the user's **core language setting** — that *is* the runtime locale switch; the GM picks it globally, no module code.
- **Keys** all prefixed `SURVIVAL.`; **whole sentences with placeholders**, never concatenated fragments (so Russian word order works). `game.i18n.format("SURVIVAL.Shortfall.separated", {name, kind, pool})`.
- **Plurals/numbers** via a tiny helper using `Intl.PluralRules` / `Intl.NumberFormat` keyed to `game.i18n.lang` (Russian gets `one/few/many/other`). Test missing keys with `game.i18n.has` — *not* `??` (Foundry's `format` returns the key string on a miss, so `??` never fires).
- **Item-name matching is config, not translation.** The "what counts as water" match list lives in a **locale-independent world setting** (seeded from a config file), *not* in `lang/*.json` — because content language (English pf2e item names) is independent of UI locale. Resolution order: per-item override flag → system slug/trait/type heuristic → the configurable match list.
- **Honest scope note:** module *flavor* labels ("Frostbitten") are fully localized; the *actual* applied condition ("Clumsy 2") shows in pf2e's own localization, which we don't own. Correct behaviour, worth stating so it's not read as a gap.

---

## 6. Extensibility

- **New system (e.g. dnd5e):** zero core changes — write `Dnd5eAdapter implements SurvivalSystemAdapter` (TS fails the build if a method is missing), register it by `game.system.id`, add the relationship to `module.json`. Unknown systems fall back to `GenericAdapter`.
- **New optional element (Dial 9):** each extra is a small `SurvivalExtension` unit (`onTick`, `onUpkeepDialog`, `registerSettings`) the engine iterates *when enabled*. A new extra = one file + a registration line + a setting + lang keys; the resolver and ladder are untouched. Discretionary extras carry `runForCatchUp: false` so a 14-day montage doesn't roll 14 foraging checks. Warmth firewood always resolves before any cooking extra.

---

## 7. File layout, manifest, tooling

```
shards-survival/
├─ module.json · package.json · vite.config.ts · tsconfig.json
├─ src/
│  ├─ module.ts                 # init/ready: settings, adapter resolve, hooks; socket register in socketlib.ready
│  ├─ settings.ts               # the dials + thresholds + climate presets (declarative)
│  ├─ core/  SurvivalEngine · Resolver · AllocationLedger · LadderEngine · ClimateModel · Caravan · time · migrations · extensions/
│  ├─ systems/  SurvivalSystemAdapter(interface) · registry · Pf2eAdapter · Dnd5eAdapter · GenericAdapter
│  ├─ apps/  GmControlPanel · PartyHud · UpkeepDialog · sheet-injection
│  ├─ net/socket.ts             # socketlib executeAsGM handlers
│  └─ util/i18n.ts              # Intl.PluralRules / NumberFormat helpers
├─ templates/*.hbs · styles/survival.css
├─ packs/                       # seeded compendium: "Water (day)", "Firewood (bundle)" items (Ledger mode)
└─ lang/  en.json · ru.json
```

```jsonc
// module.json essentials
{
  "id": "shards-survival",
  "compatibility": { "minimum": "13", "verified": "14" },   // NO maximum
  "esmodules": ["scripts/module.js"],
  "relationships": {
    "systems":    [ { "id": "pf2e", "type": "system" } ],     // advertised, not hard-required
    "requires":   [ { "id": "socketlib" } ],                  // the one hard dep
    "recommends": [ { "id": "foundryvtt-simple-calendar" }, { "id": "seasons-and-stars" } ]
  }
}
```

- **TypeScript + Vite** — TS is the right call *because* of the adapter contract: the compiler guarantees every adapter implements every verb. Built output → `scripts/module.js` (match the manifest path). `module.json`, `lang/`, `templates/`, `styles/`, `packs/` go in `public/` and Vite copies them.
- **socketlib** registers in the **`socketlib.ready`** hook (registering in plain `init` throws).
- **Release:** semver; bump `version` + `compatibility.verified` together; a GitHub Action zips the build and publishes a `manifest`/`download` URL pair for auto-update.

---

## 8. Migrations & risk register

- **Two-level `dataVersion`** (registry + per-actor flag); on `ready`, GM-only, run ordered `(old)→new` passes *before* any write. Actor-flag migrations run lazily the first time a tick touches an actor. Also a **`ready` reconciliation** that catches up to the current world-day if a day passed while no GM was online.
- **Cross-campaign reset action** zeroes `lastTickDay` + every actor's counters (the vault is reused; this *will* be needed).
- Risk table (all local fixes, no architectural dead-ends): player-write clobber → separate `warmth` flag key + all writes via `executeAsGM`; double-execution → `isPrimaryGM()` + re-entrancy lock; world-time edge cases → boundary math + capped catch-up + rewind prompt; registry races → document-backed atomic updates; system-coupling leaks → ESLint rule; save-data → versioned migrations tested from empty *and* populated worlds.

---

*One-line summary:* a system-neutral `SurvivalEngine` (transactional `Resolver` + `LadderEngine` + `ClimateModel`) over a **document-backed** Caravan registry (separation = per-group `withParty` booleans enforced at the sourcing layer) and per-actor flags, all system specifics behind a registered `SurvivalSystemAdapter` whose **one `reconcileConsequences` verb** maps stages to native conditions (pf2e) or aggregate Exhaustion (5e), ticked once per survival-day on the primary GM client, players writing via `socketlib.executeAsGM`, four ApplicationV2 surfaces, and `Intl`-backed i18n — lean by default, rich when the dials turn up.
