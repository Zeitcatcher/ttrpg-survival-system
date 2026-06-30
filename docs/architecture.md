# Technical Architecture (finalized — step 2)

> **Status: FINALIZED (2026-06-30)** against the locked decisions ([mechanics §10](survival-mechanics.md)). **Part A** below is the architecture; **Part B** (appended) is the implementation-level detail — concrete data shapes, the full settings registry, the socket catalog, the `readModel()`, the `runTick` sequence (incl. week/N-day advance), compendium seeding, and unit-test seams; **B.9** lists the corrections applied after a verification pass. The phased build sequence lives in [implementation-plan.md](implementation-plan.md).
>
> **Module id:** `shards-survival` · **Stack:** TypeScript + Vite · **i18n:** English default, locale-ready from day one.

**Platform reconciliation:** your saved environment targets **Foundry v14.364 + pf2e v8.2.0**. The architecture targets `minimum: 13`, `verified: 14`, **no `maximum`** (a `maximum` would lock players out of future Foundry with no override). On v13+/v14 the sheet/app layer is fully ApplicationV2, which removes the v12-era pf2e-sheet caveats an earlier draft worried about.

---

## 0. Pillars (non-negotiables)

1. **Core never names a system.** The string `"pf2e"` lives only inside `src/systems/`. A lint rule bans `game.system.id` outside that folder.
2. **One write authority.** Every shared-state mutation runs on the **primary GM client**; players round-trip through `socketlib.executeAsGM`.
3. **One day code path.** World-clock crossing, Rest, and the Advance-a-Day/Week control all converge on `SurvivalEngine.runTick()`.
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
  consumes: { food:number; water:number } | "offBooks";  // default size-based (Huge ×4 for Chiga-Biga); "offBooks" is an opt-out
  applyConsequences: boolean;                             // default false (narrate, don't auto-condition an NPC)
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
- **Rest-for-the-Night** and the **Advance a Day / Week (or N days)** controls → call `runTick(currentDay + N)` **directly**. They do *not* go through `game.time.advance()` — PF2e's Rest advances a system-computed duration (often 8h, configurable) and conflating "a survival day passed" with "world time advanced 86400s" is what creates double-advance bugs against a calendar module. All three converge on `runTick`; only the clock hook does boundary arithmetic. (A week advance is just `N = 7` through the same day-interleaved loop in §3.2.)

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
- **Catch-up cap** (`maxCatchUpDays`, default 14 — comfortably covers a one-day or one-week advance) — on overflow (e.g. the ~1.5-month desert crossing), *ask* the GM: process the cap as a montage, or apply a lump deprivation summary. Never silently under-charge.
- **Re-entrancy lock** — world-state-backed, so the Rest hook and the world-time hook can't both enter `runTick` for the same day.
- **Dangling UUID resilience** — a pool whose actor no longer resolves (the mount died) is skipped with *"its supplies are lost"* + a GM cargo-disposition prompt — never a crash.

---

## 4. UI (ApplicationV2)

Four surfaces, all `HandlebarsApplicationMixin(ApplicationV2)`:
- **GmControlPanel** (GM): the headline readout, per-pool `With party?` toggles + the Delving preset, the roster (per-consumer status, **visible clocks**, needs override, a red "no reachable supply" badge for mis-configured consumers), the climate picker, and an **Advance Day / Week (or N days)** control. Click-a-number pool edits commit on **blur/Enter** (not per-keystroke).
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

---

## Part B — Implementation-level detail (finalized for build)

This appendix adds the concrete shapes, settings, sockets, read-model, tick sequence, seeding, and test seams needed to start coding. It does not revise Part A; where Part A sketched a type, this finalizes it.

---

### B.1 v1 Abstract mode — data shapes and the read-model that hides Ledger

**Principle:** Abstract and Ledger differ only in *where the numbers come from*. The Resolver, LadderEngine, ClimateModel, UI, and `readModel()` never branch on the mode. The split is entirely behind two adapter verbs (`getAvailable` / `consume`) plus one pool-storage shape.

#### B.1.1 Abstract pool storage

In Abstract mode there is **no real Actor inventory to read**. A pool's day-counts live directly on the **Caravan document flags**, keyed by the pool's logical id (the same UUID slot the registry already uses, but the value is a count map rather than a dereferenced actor inventory):

```ts
// Stored at: caravanDoc.flags["shards-survival"].abstractPools[poolId]
interface AbstractPoolCounts {
  food: number;      // creature-days of rations
  water: number;     // creature-days of water
  firewood: number;  // bundles (camp-nights)
}
// caravanDoc.flags["shards-survival"].abstractPools : Record<string /*poolId*/, AbstractPoolCounts>
```

`poolId` = the pool/mount's registry key. For mounts (which are also pools) the same `poolId` carries the mount's own carried supply. PCs in Abstract v1 carry no per-PC inventory by default; a personal pack, if the GM wants one, is just another `AbstractPoolRef` with `personal: true` and an `ownerUuid`.

#### B.1.2 The Abstract adapter (used by core unchanged)

```ts
// AbstractStore is injected; it reads/writes caravanDoc flags via executeAsGM-on-GM path.
class AbstractAdapterShim {
  getAvailable(poolId: string, kind: ResourceKind): number {
    return this.store.abstractPools[poolId]?.[kind] ?? 0;
  }
  // consume() is virtual in Abstract: it returns a delta the AllocationLedger applies;
  // the actual count write is the per-day batch commit (B.5), not a Foundry item update.
  applyDelta(poolId: string, kind: ResourceKind, units: number): void {
    this.store.abstractPools[poolId][kind] -= units;   // clamped ≥ 0 at commit
  }
}
```

The real `SurvivalSystemAdapter` (Part A §1.1) is still the seam for **creature needs, grace, warmth, conditions** — those are system facts (PF2e Con-mod, Cold-Weather Clothing, native conditions) and are identical in Abstract and Ledger. Only `getResourceLots`/`getAvailable`/`consume`/`grant` are sourced differently.

#### B.1.3 "Days of supply" headline (Abstract)

```
daysOfSupply(kind, group) =
   floor( sum over PRESENT pools of counts[poolId][kind]
          / max(1, dailyGroupNeed(kind, group)) )

dailyGroupNeed(food, group)  = Σ over present consumers c of ceil(ration(c).food  * sizeMult(c))
dailyGroupNeed(water, group) = Σ over present consumers c of ceil(ration(c).water * sizeMult(c) * climateWaterMult(band))
dailyGroupNeed(firewood,grp) = (band needs warmth && not all-warm-by-clothing) ? bundlesPerNight(band) : 0
```

`climateWaterMult`: temperate ×1, hot ×2, extremeHeat ×3. `bundlesPerNight`: cold 1, extremeCold 2, else 0. "Present" = `withParty[group] === true` (separation filter applied **before** the sum — a separated pool contributes 0, producing the visible cliff). Headline is recomputed in `readModel()`, never stored.

#### B.1.4 Click-the-number edit (Abstract write path)

GM clicks a pool count in `GmControlPanel` → edits inline → commits on **blur/Enter** → `requestEditPool{poolUuid,kind,value}` → GM handler writes `caravanDoc.update({"flags.shards-survival.abstractPools.<poolId>.<kind>": value})`. One atomic document update; the `updateDocument` hook re-renders all surfaces. No tick runs. Negative values clamp to 0.

#### B.1.5 Where Ledger (v2) diverges — and where it does not

| Concern | Abstract (v1) | Ledger (v2) | Visible to UI? |
|---|---|---|---|
| Source of counts | `abstractPools[poolId][kind]` on Caravan doc | `adapter.getResourceLots(actor, kind)` over the pool actor's real items | **No** — both feed `getAvailable`-shaped numbers |
| Decrement | `applyDelta` on in-memory counts → batch write to flags | `adapter.consume(actor, kind, units)` → real item qty update + 7-ration decomposition | **No** |
| Edit a number | write flag count | edit the underlying item quantity (or grant/consume to match) | **No** — same click-a-number affordance |
| Personal packs | optional `personal` AbstractPoolRef | real PC inventory items | No |
| Seeded items | not needed | `packs/` "Water (day)", "Firewood (bundle)" required | Only in item sheets |

**The read-model is the firewall.** `readModel()` (B.4) calls a single `Sourcing` facade — `sourcing.available(poolId, kind)` — which Abstract backs with flag counts and Ledger backs with `adapter.getAvailable(resolve(poolId), kind)`. The three UI surfaces consume `readModel()` only; they are byte-for-byte identical across modes. The mode is a single world setting (`supplyDetail`) that selects which `Sourcing` implementation is constructed at `ready`.

---

### B.2 Complete settings registry

All registered in `settings.ts`. Namespace `shards-survival`. `onChange` listed only where non-trivial. World scope unless noted. The-Shards defaults in the Default column.

| Key | Scope | Type | Default (The Shards) | config | onChange |
|---|---|---|---|---|---|
| `supplyDetail` | world | `"abstract"\|"ledger"` | `"abstract"` | true | rebuild Sourcing; re-render panels |
| `trackedNeeds` | world | `{food:bool,water:bool,firewood:bool}` (object via menu) | `{food:true,water:true,firewood:true}` | false (menu) | re-render |
| `upkeepPrompt` | world | `"always"\|"onlyWhenWrong"` | `"onlyWhenWrong"` | true | — |
| `sourceMode` | world | `"personalFirst"\|"communalFirst"` | `"communalFirst"` | true | — |
| `climateModel` | world | `"off"\|"manual"\|"auto"` | `"manual"` | true | re-render climate picker |
| `lethalDeprivation` | world | `"capStage3"\|"climbToDeath"` | `"capStage3"` | true | — |
| `splitPartyMode` | world | `"single"\|"named"` | `"single"` | true | re-render roster/pools |
| `foraging` | world | `boolean` | `false` | true | toggle extension |
| `extras` | world | `Record<extraId,boolean>` (menu) | all `false` | false (menu) | toggle extensions |
| `maxCatchUpDays` | world | `number` | `14` | true | — |
| `climatePresets` | world | `Record<presetId,ClimateBand>` (seeded) | the 5 presets below | false | — |
| `itemMatchList` | world | `{food:string[],water:string[],firewood:string[]}` | seeded from config (B.6) | false (menu) | invalidate Ledger cache |
| `graceFormula` | world | `"conModPlus1"\|"flat"` + `{flat:number}` | `"conModPlus1"` | false (menu) | — |
| `thresholds` | world | `LadderThresholds` (B.2.1) | the spec ladders | false (menu) | — |
| `combinedCap` | world | `"fatiguedPlusOne"\|"uncapped"` | `"fatiguedPlusOne"` | false | — |
| `mountDefaultApplyConsequences` | world | `boolean` | `false` | true | — |
| `dataVersionRegistry` | world | `number` | current | false | — (migration bookkeeping) |
| `dataVersionActorFlag` | world | `number` | current | false | — |
| `lastTickDay` | world | `number` | `0` | false | — (idempotency pointer) |
| `caravanDocUuid` | world | `string` | `""` (set on first init) | false | — |
| `panelCollapsed` | **client** | `boolean` | `false` | false | — |
| `hudDensity` | **client** | `"compact"\|"full"` | `"full"` | true | re-render HUD |
| `showGmClocksToPlayers` | world | `boolean` | `true` | true | re-render HUD |

A `registerMenu("configApp")` opens the richer editor for the object-typed settings (`trackedNeeds`, `extras`, `itemMatchList`, `thresholds`, `graceFormula`).

#### B.2.1 Ladder thresholds shape (editable, defaults = the spec)

```ts
interface LadderThresholds {
  hunger: { graceExtra: 0; stageDays: [1, 2, 2]; }   // days from grace-end to S1,S2,S3
  thirst: { graceExtra: 0; stageDays: [1, 1, 1]; heatGracePenalty: 1; }
  cold:   { graceExtra: 0; stageDays: [1, 1, 1]; extremeColdStagePerNight: 1; }
}
```

#### B.2.2 Climate presets (seeded default)

```ts
{ coast_temperate:"temperate", desert_hot:"hot", sunhills_temperate:"temperate",
  northern_cold:"cold", default_temperate:"temperate" }
```

Band → effects table (`ClimateModel.forBand`): temperate `{waterMult:1,cold:false,bundles:0}`, hot `{2,false,0}`, extremeHeat `{3,false,0,thirstGracePenalty:1}`, cold `{1,true,1}`, extremeCold `{1,true,2,coldStagePerNight:1}`.

---

### B.3 Socket message catalog

All registered in the `socketlib.ready` hook; all invoked via `socketlib.executeAsGM`. Direction is always **player → GM** (or GM → GM for uniformity). Each returns a result or a typed rejection (`{ok:false, reason}`); callers await and surface a "no GM online" rejection. **Warmth is routed through the GM too**, despite being an owner-writable flag, so there is exactly one write authority and no clobber special-case.

| Message | Payload | Direction | GM-side handler |
|---|---|---|---|
| `requestAdvanceTime` | `{days:number}` | player/GM → GM | `SurvivalEngine.runTick(currentDay + days)`; returns the consolidated summary read-model delta |
| `requestSetWarm` | `{actorUuid, warm:boolean}` | player → GM | write `actor.flags["shards-survival"].warmth = warm`; re-render; **no tick** |
| `requestForage` | `{actorUuid}` | player → GM | if foraging on: `adapter.rollForage(actor, dc)`, apply result to communal pool / Fatigued; return outcome |
| `requestEditPool` | `{poolUuid, kind, value:number}` | GM → GM | Abstract: write `abstractPools[poolId][kind]`; Ledger: reconcile item qty; clamp ≥0; no tick |
| `requestToggleWithParty` | `{poolUuid, group, withParty:boolean}` | GM → GM | set `withParty[group]`; atomic doc update; re-render (headline cliff) |
| `requestDelvingPreset` | `{group, setUnderground:boolean}` | GM → GM | set every pool/mount `withParty[group]=false` in one update; if `setUnderground`, set delvers' band → temperate |
| `requestSetClimate` | `{group, band:ClimateBand}` | GM → GM | `store.climate[group]=band`; re-render |
| `requestToggleConsumer` | `{actorUuid, group, enabled:boolean}` | GM → GM | set `MemberRef.enabled` ("Иримэ is fasting") |
| `requestSetMountConsumes` | `{mountUuid, consumes}` | GM → GM | set `MountRef.consumes` (size-mult or `"offBooks"`) |
| `requestSetMountApplyConsequences` | `{mountUuid, on:boolean}` | GM → GM | per-mount narrate-only ↔ auto-condition toggle |
| `requestConfirmUpkeep` | `{group, overrides?}` | GM → GM | commit the dialog's pre-filled resolution (only when a card opened) |
| `requestCargoDisposition` | `{poolUuid, disposition}` | GM → GM | dangling/dead-mount supplies: `"lost"\|"looted"\|"dropped"` |
| `requestResetSurvival` | `{scope:"all"\|group}` | GM → GM | cross-campaign reset: zero `lastTickDay` + per-actor counters |
| `notifyTickComplete` | `{summaryByGroup}` | GM → all (broadcast) | clients re-render PartyHud + show whispered per-player clock nudges |

`executeAsGM` for the GM→GM rows still runs on the primary GM (the panel may be open on a secondary GM client); routing everything through it keeps a single code path.

---

### B.4 The read-model (`SurvivalEngine.readModel()`)

All three UI surfaces consume exactly this. Pure projection over the registry + adapter + Sourcing facade; no writes; safe to call on any client (it only reads).

```ts
type ResourceKind = "food" | "water" | "firewood";
type TrackKey = "hunger" | "thirst" | "cold";
type ClimateBand = "temperate"|"hot"|"extremeHeat"|"cold"|"extremeCold";

interface ReadModel {
  supplyMode: "abstract" | "ledger";
  splitMode: "single" | "named";
  groups: GroupView[];
  generatedAtDay: number;          // lastTickDay
}

interface GroupView {
  group: string;                   // "Main"
  climate: ClimateBand;
  headline: {                      // creature-days, climate-adjusted, separation-filtered
    food: number; water: number; firewood: number;
  };
  firewoodNeeded: boolean;         // band needs warmth this group
  pools: PoolView[];
  roster: RosterEntry[];
  shortfalls: Shortfall[];
}

interface PoolView {
  poolId: string; label: string;   // "Chiga-Biga (base)"
  kind: { food: number; water: number; firewood: number };  // current counts
  withParty: boolean;              // for THIS group
  separated: boolean;              // !withParty — render greyed + tag
  isMount: boolean;
  handlerName?: string;            // "Ракакак"
}

interface RosterEntry {
  actorUuid: string; name: string;
  sizeMult: number;                // 1 | 2 | 4
  isMount: boolean;
  consumes: boolean;               // false ⇒ "off the books" / needs=0
  zeroNeeds: boolean;              // needs===0 (mephits, Guenhwyvar) — shown as "no needs"
  todayDraw: { food: number; water: number };   // what it pulled on the last tick
  tracks: Record<TrackKey, TrackView>;
}

interface TrackView {
  daysDeprived: number;
  grace: number;                   // Con-mod + 1 (heat-adjusted for thirst)
  stage: 0 | 1 | 2 | 3 | 4;
  statusName: string;              // localized: "Thirsty", "Wasting", "" if stage 0
  capped: boolean;                 // true if combined-cap clamped this track's condition
}

interface Shortfall {
  actorUuid: string; name: string;
  kind: ResourceKind;
  namedCause: string;              // localized: "the base is separated on the surface"
  clock: string;                   // "Thirst clock → 2 of 3 days"
  isMountNarrateOnly: boolean;     // true ⇒ GM alert, no condition applied
}
```

`PoolView.kind` is sourced via the Sourcing facade (Abstract flags or Ledger lots) — identical shape either way. `RosterEntry.todayDraw` is read from per-actor flags written by the last tick; on a never-ticked world it is `{0,0}`.

---

### B.5 `runTick` sequence including week / N-day advance

`runTick(targetDay)` is the single code path (world-clock hook, Rest, and the Advance Day/Week/N control all converge here). GM-only, re-entrancy-locked.

```
runTick(targetDay):
  guard isPrimaryGM() AND acquire world-backed re-entrancy lock
  load CaravanStore, dials, adapter, Sourcing facade
  firstDay = lastTickDay + 1
  capDay   = lastTickDay + maxCatchUpDays
  if targetDay > capDay:                          // OVERFLOW
     → prompt GM (UpkeepDialog overflow mode): "montage to cap" | "lump deprivation summary"
       montage: process days firstDay..capDay normally, then jump lastTickDay=targetDay (no further consumption)
       lump:    compute aggregate deprivation for (targetDay-lastTickDay) days in one ladder pass, set lastTickDay=targetDay
     → emit summary, release lock, return
  consolidated = new SummaryAccumulator()
  for d in firstDay .. min(targetDay, capDay):     // DAY-INTERLEAVED
     for each GROUP:
        band       = ClimateModel.forBand(store.climate[group])
        presentPools = pools/mounts where withParty[group]===true        // SEPARATION FILTER (at sourcing)
        consumers  = members in group where enabled && needsConsumption(actor) && joinedDay<=d
        ledger     = new AllocationLedger(presentPools, Sourcing)         // transactional in-memory copy
        // --- PC/NPC consumers ---
        for c in consumers (size-sorted is irrelevant; order is source-priority per consumer):
           need = climate-adjusted ration(c)                              // water ×waterMult, size ×mult
           for kind in [food, water]:
              drawn = ledger.draw(c, kind, need[kind], sourceOrder(c))    // decrements ledger immediately
              record c.todayDraw[kind] = drawn
              if drawn < need[kind]: shortfall(c, kind, cause=whyDry(c,kind,group))   // after WHOLE chain dry
        // --- MOUNTS as consumers (decision C) ---
        for m in mounts in group where withParty[group] && consumes !== "offBooks":
           mneed = sizeMult(m) × base ration, water ×waterMult            // Chiga-Biga ×4
           draw STRICTLY from m's own poolId → storage (never a PC pack)
           if short: if m.applyConsequences → ladder like a consumer
                     else → narrate-only GM alert (Shortfall.isMountNarrateOnly=true)
        // --- firewood / warmth (whole camp; BEFORE any cooking extra) ---
        if band.bundles>0: burn = camp warmth need; ledger.draw(camp, firewood, band.bundles)
           per character: warm = isWarmSourceEquipped(actor) || campfireLit || warmShelter
        // --- ladder advance, day d ---
        for actor in consumers (and mounts with applyConsequences):
           for track in [hunger, thirst, cold]:
              satisfied = (track fed/watered/warm this day)
              LadderEngine.advanceOrClear(actor, track, satisfied, grace, thresholds, band)
                 satisfied → daysDeprived=0; stage steps toward 0 (recovery: −1/night)
                 deprived  → daysDeprived++; stage = stageFor(daysDeprived, grace, thresholds), capped at lethal dial
        consolidated.absorb(group, d, draws, shortfalls, clocks)
     // --- per-day batch commit (so a GM hand-off mid-loop resumes) ---
     commit: Sourcing.flush(ledger deltas)                                // Abstract: write abstractPools; Ledger: adapter.consume() batched
           + write per-actor flags (daysDeprived/stage/todayDraw/warmth-consumed)
           + reconcileConsequences(actor, unionStagesAcrossTracks)        // ONE call, combined-cap clamped
     lastTickDay = d                                                      // committed per day
  emit ONE consolidated whispered summary per group (named-cause shortfalls + per-character clocks)
  if upkeepPrompt=="onlyWhenWrong" && all-green: silent whisper, no dialog
  else open UpkeepDialog (one Confirm, pre-filled)
  broadcast notifyTickComplete{summaryByGroup}
  release lock
```

**Key invariants enforced here:**
- **Transactional:** `AllocationLedger.draw` decrements the working copy; `Σ draws ≤ initial availability` always; two consumers never both see the full pool.
- **Day-interleaved escalation:** a 6-day advance that goes dry on day 4 reaches the correct late stage (e.g. Wasting), not Stage 1 ×6.
- **`reconcileConsequences` union + cap:** core computes the union of all tracks' demanded conditions, clamps to "Fatigued + one other," then calls reconcile **once** — so recovering thirst doesn't strip the Fatigued that hunger still demands.
- **Mounts draw own→storage only**, never a PC pack; default narrate-only.
- **Rewind:** `targetDay < lastTickDay` sets the pointer back without refunding; a large backward jump prompts "new campaign? reset survival tracking?".
- **Catch-up idempotency:** `lastTickDay` committed per day; re-running the same span is a no-op.

---

### B.6 Compendium seeding (`packs/`)

The module ships a compendium pack `shards-survival.survival-items` containing two Items: **"Water (day)"** (1 unit = one creature-day of water; full waterskin = qty 2) and **"Firewood (bundle)"** (1 unit = one camp-night). Native "Rations" (1 week) is decomposed to 7 day-units by the adapter — not seeded.

- **When:** seeded **lazily on first need in Ledger mode only.** On `ready`, GM-only, if `supplyDetail === "ledger"` and the seed flag `flags["shards-survival"].seeded !== dataVersion`, import the two Items into the world (or just leave them in the compendium and let `getResourceLots` resolve from the pack). Set the seed flag.
- **Abstract v1 does not need them** — counts live on the Caravan doc, no Items exist. So seeding is skipped entirely while `supplyDetail === "abstract"`, and runs the first time the GM flips to Ledger.
- The seeded Item names are added to `itemMatchList` so `getResourceLots` recognizes them; the dropdown sheet-injection lets a GM tag any homebrew item as food/water/firewood via the per-item override flag (checked first, before the match list).

---

### B.7 Mount-as-consumer specifics (decision C)

A mount is **simultaneously a consumer and a pool** (`MountRef extends PoolRef`). Chiga-Biga is the proof case: one Actor = mount + base + stockpile, one UUID, one `withParty` toggle.

```ts
interface MountRef extends PoolRef {
  consumes: { food: number; water: number } | "offBooks";  // default = size-based (Huge ⇒ ×4 base ration)
  applyConsequences: boolean;          // default = setting mountDefaultApplyConsequences (false)
  isStorage: boolean;                  // Chiga-Biga: true
  handlerUuid?: string;                // Ракакак → whispers read "Ракакак notes Chiga-Biga is hungry"
}
```

- **As consumer:** size mult drives need (Large ×2, **Huge ×4**); in `runTick` the mount draws from **its own `poolId` → shared storage**, never a PC pack. Chiga-Biga in Hot weather = 4 food + 8 water/day, visibly drawing the base down (16 Water → 8 → dry day 3) — the pressure decision C exists to add. `"offBooks"` opts a mount out of consumption entirely (one click).
- **As pool:** the same `poolId` is in `presentPools`; the `withParty` toggle separates beast + entire stockpile at once.
- **Deprivation default = narrate-only:** if `applyConsequences === false`, a shortfall on a mount produces `Shortfall.isMountNarrateOnly = true` — a GM alert (*"Chiga-Biga is going hungry"*, handler-attributed) and **no** native condition on the NPC. The per-mount `applyConsequences` toggle opts that single mount into the full ladder (then it runs through `LadderEngine` + `reconcileConsequences` like any consumer).
- **Single-point-of-failure:** if the mount Actor UUID no longer resolves (died/looted), its pool is skipped with a cargo-disposition prompt (`requestCargoDisposition`) — never a crash.

---

### B.8 Test seams (pure, no live Foundry)

These run under Vitest against a **mock adapter** (`MockAdapter implements SurvivalSystemAdapter`) and a **mock Sourcing** (in-memory count maps). No `game`, no `Actor`, no DOM.

| Unit | What's pure | The property/assertion tested |
|---|---|---|
| **AllocationLedger / Resolver** | yes — pure in-memory | **Transactional invariant:** for any pool set + consumer set + source order, `Σ draws[kind] ≤ Σ initialAvailability[kind]`; no consumer draws from a pool not in `presentPools` (separation); communal-first vs personal-first order respected. |
| **LadderEngine.advanceOrClear** | yes | grace = `graceDays` honored (no stage before grace ends); deprived increments and `stageFor` matches thresholds; **reset-on-satisfied** zeroes `daysDeprived` and steps stage −1/night; recovery runs even after threat gone; lethal dial caps at 3 unless `climbToDeath`. |
| **combined-cap clamp** | yes | union of three tracks' demanded conditions clamps to "Fatigued + one other"; recovering one track never strips a condition the others still demand (diff against union, not per-track). |
| **ClimateModel.forBand** | yes | band → `{waterMult, cold, bundles, thirstGracePenalty}` math; `dailyGroupNeed` water scales ×1/×2/×3; firewood need only when band warmth-relevant. |
| **catch-up idempotency** | yes | running `runTick(d)` then `runTick(d)` again is a no-op; `runTick(d+6)` that goes dry on +4 reaches the correct late stage (day-interleaved); rewind sets pointer back without refund; overflow path picks montage/lump deterministically. |
| **separation filter** | yes | a pool with `withParty[group]===false` is absent from `presentPools` and contributes 0 to both allocation and the headline (the "cliff"); a missing `withParty[newGroup]` key defaults to false (fail-loud). |
| **Sourcing facade parity** | yes | the same consumer/pool scenario produces identical `readModel()` headline + draws whether backed by Abstract counts or Ledger lots (the firewall property). |

The mock adapter returns fixed `getCreatureRation`, `getGraceDays`, `isWarmSourceEquipped`, and records `reconcileConsequences` calls for assertion. `MountRef`, `MemberRef`, and `AbstractPoolCounts` are plain data — constructible in tests without Foundry. The Foundry-coupled layers (document `update()`, socketlib, ApplicationV2 render, sheet injection) are the **only** parts requiring an integration harness and are kept thin so the core stays fully unit-testable.

---

### B.9 — Corrections applied after review

A verification pass against the locked decisions caught the following; these **supersede** anything above that conflicts.

1. **Heat thirst-grace has one home — the band.** `effectiveGrace = getGraceDays(actor,'thirst') − band.thirstGracePenalty` is computed inside the per-track step of B.5 (Extreme Heat → −1 day). The duplicate `thirst.heatGracePenalty` in `LadderThresholds` (B.2.1) is removed; the climate band is the single source.

2. **Extreme-cold acceleration is one field, consumed in the ladder.** On an unwarmed cold night the ladder advances `daysDeprived += (1 + band.coldStagePerNight)` (Extreme Cold → +2/night). The duplicate `cold.extremeColdStagePerNight` in `LadderThresholds` is removed.

3. **`trackedNeeds` actually gates the math.** `dailyGroupNeed(kind)`, the headline, and `RosterEntry.tracks` skip a disabled need — turning **Food** off removes it from the headline, the resolver, and the ladders (not just the UI).

4. **The read-model carries the previously-missing fields:**
   - `RosterEntry.blockedHealing: boolean` (Decision D) — so the HUD can show *why* a healer's HP restoration isn't landing.
   - `Shortfall.handlerName?: string` — mount narrate-only attribution (*"Ракакак notes Chiga-Biga is going hungry"*).
   - `GroupView.extrasView` — a projection slot for extra-owned rows (the hot-meal "cook?" toggle, the desert "next water in N days" countdown) so extras render **without** polluting the core need rows.
   - `TrackView.capped` is defined as: *"this track's demanded condition was suppressed by the combined cap."*

5. **Lump catch-up is explicitly an approximation.** On overflow beyond `maxCatchUpDays`: **montage** processes the cap exactly then skips the remainder; **lump** applies the end-state stage for the whole span in one pass (no day-interleaving). The two can therefore yield different stages — by design — and the overflow card says so.

6. **Personal waterskins exist in Abstract v1.** The Shards fixture (plan **M1**) seeds a personal `AbstractPoolRef` (2 Water) per PC, so the canonical Ssir-Kat "waterskins empty on day 2" beat is reproducible under the locked Abstract defaults. Personal packs remain optional in general; the fixture turns them on.

7. **`climateModel:"auto"` is an inert stub in v1** (Decision H locks Manual band). It registers but does nothing until a weather-module reader lands; its `onChange` no-ops in v1.

8. **`graceFormula.flat`** is retained as an intentional homebrew escape hatch; `conModPlus1` is the locked default and the only value the fixtures use.

9. **B.6 seeding trigger is singular:** seed the `Water (day)` / `Firewood (bundle)` items **once, on first Ledger enable** (matches plan **M8**) — never at `ready` while `supplyDetail === "abstract"`.
