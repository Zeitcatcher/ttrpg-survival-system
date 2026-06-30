# Implementation Plan

> **Module:** `ttrpg-survival-system` · **Stack:** TypeScript + Vite · **Target:** Foundry v13+/v14, pf2e v8.2.0 · **v1 scope:** Abstract supply mode (Decision A).
> Ground truth: [`survival-mechanics.md`](./survival-mechanics.md) + [`architecture.md`](./architecture.md). This plan operationalizes both. Where they disagree, the docs win — flag and ask.

This plan builds a **walking skeleton first**, then sequences the three differentiators — **the separation rule**, **mount-as-consumer (Chiga-Biga ×4)**, and **week / N-day advance** — to land in M2, the very first feature milestone after scaffold and registry. The engine heart is testable headless before any polished UI exists.

---

## Guiding sequencing principle

1. **M0–M1** = it loads, registers, and persists a registry document. Nothing player-visible yet beyond "the module is alive."
2. **M2** = the engine heart. Separation filter, AllocationLedger, mount consumer, and the day-interleaved N-day loop all exist and are **proven by headless unit tests** before any condition or UI work. This is where the architecture's hardest invariants live, so it gets exercised earliest.
3. **M3** = consequences become real (native pf2e conditions via `reconcileConsequences`, climate/warmth).
4. **M4–M5** = the human surfaces (GM panel, Player HUD, Upkeep card, green-day suppression, consolidated summary).
5. **M6–M9** = extras, i18n, the v2 Ledger groundwork, and release.

A vertical slice is demoable from **M2 onward** via the dev console; from **M4** via the real UI.

---

## M0 — Scaffold + tooling (the walking skeleton)

**Goal:** A module that installs in Foundry v14, loads with zero errors, registers one socket, and prints a visible "alive" banner + a stub `game.modules.get("ttrpg-survival-system").api.ping()`. CI builds and a release action exists. This is the smallest end-to-end thing that loads and does something visible.

**Tasks**
- Init repo `ttrpg-survival-system/` with `package.json`, `tsconfig.json` (strict), `vite.config.ts` (build → `scripts/module.js`; copy `public/` assets).
- `module.json`: id `ttrpg-survival-system`, `compatibility { minimum:"13", verified:"14" }` — **NO `maximum`**; `esmodules:["scripts/module.js"]`; `relationships.requires:[socketlib]`, `systems:[pf2e advertised]` (no calendar dependency — the tick runs off core `updateWorldTime`); `languages:[en, ru]`.
- `src/module.ts`: `init`/`ready` hooks; register socketlib handler in the **`socketlib.ready`** hook (not `init` — it throws); expose `module.api` with a `ping()` stub; `ui.notifications.info` "alive" banner on `ready`.
- Empty `lang/en.json` + `lang/ru.json` with one key each (`SURVIVAL.Alive`).
- **ESLint rule** banning `game.system.id` / `"pf2e"` outside `src/systems/` (Pillar 1 — wire it now so it guards every later PR).
- Vitest config + one trivial passing test (proves the headless harness works).
- GitHub Actions: `ci.yml` (lint + typecheck + test + build on PR) and `release.yml` (on tag: zip build, publish `module.json` + `module.zip` with manifest/download URLs).

**Files created:** `module.json`, `package.json`, `vite.config.ts`, `tsconfig.json`, `.eslintrc`, `src/module.ts`, `lang/en.json`, `lang/ru.json`, `vitest.config.ts`, `test/smoke.test.ts`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`.

**Acceptance:** `npm run build` emits `scripts/module.js`; dropping the build into Foundry v14 loads with no console errors; `game.modules.get("ttrpg-survival-system").api.ping()` returns `"pong"`; an "alive" notification shows on world load; CI is green on the first PR.

**Dependencies:** none.
**Size:** M.
**Key risks:** Vite asset-copy path mismatch vs the manifest `esmodules` path (mitigate: assert the output path in build); socketlib registered too early (use `socketlib.ready`).

---

## M1 — Caravan registry document + settings registry + read-model skeleton

**Goal:** A **dedicated Caravan document** (Actor or JournalEntry) persists the registry in flags with atomic `update()`; the dials are registered as world settings; a read-model computes the at-a-glance headline (`Food N · Water N · 🔥 N`) from the registry. No tick yet.

**Tasks**
- `src/core/Caravan.ts`: the `CaravanStore` shape (`groups`, per-group `climate`, `members`, `storage`, `mounts`) per architecture §2.2. CRUD via the document's flags; **store UUID references, never embedded actors**. Provide `load()`, `save()` (queued atomic `update()`), and a `Hooks.on("updateDocument")` re-render signal.
- Choose the document kind (recommend a hidden **JournalEntry** to avoid an Actor showing in the actors directory) and a "find-or-create on first GM ready" bootstrap.
- `src/settings.ts`: declaratively register Dials 1–9 with the **locked defaults** (Supply=Abstract, needs=Food+Water+Firewood, Upkeep="only when wrong", Source=Communal-first, Climate=Manual band, Lethal=Cap@3, Split=Single-party, Foraging=off, extras=off) + `maxCatchUpDays=14`; a `registerMenu` stub for the richer config app.
- Per-actor flag schema stubs: `flags["ttrpg-survival-system"].state` (per-track `daysDeprived`/`stage`, `blockedHealing`, `joinedDay`) and a **separate** `.warmth` key (avoids the GM-write-clobbers-player-write race).
- `dataVersion` on the registry; an empty `src/core/migrations.ts` with the `(old)→new` ordered-pass skeleton.
- Read-model: `getHeadline(group)` computing pool sums in **Abstract mode** (pools are day-count numbers). Wire it to `module.api` so it's console-demoable.
- Seed a **fixture builder** for The Shards party (5 PCs, Chiga-Biga Huge×4 storage+mount, Staf ×1, mephits/Guenhwyvar needs=0) — reused by every later test.

**Files created:** `src/core/Caravan.ts`, `src/settings.ts`, `src/core/migrations.ts`, `src/core/types.ts`, `test/fixtures/theShards.ts`, `test/caravan.test.ts`.
**Files touched:** `src/module.ts` (bootstrap registry, register settings, expand `api`).

**Acceptance:** On first GM `ready` the Caravan document is created once; `api.getHeadline("Main")` returns the correct sums from a hand-seeded registry; editing a pool number and reloading the world persists; settings appear in Foundry's module-settings UI with the locked defaults.

**Dependencies:** M0.
**Size:** M.
**Key risks:** read-modify-write race on the registry (mitigate: document-backed queued `update()`, never a settings blob for the registry); choosing a doc kind that clutters the UI (use a hidden JournalEntry).

---

## M2 — The engine heart: daily tick + transactional resolver + Abstract pools + mount consumer + separation filter + WEEK/N-day advance

> **The differentiator milestone.** Everything that makes this module worth building is proven here, headless, before a single condition or pixel of polished UI.

**Goal:** `SurvivalEngine.runTick(targetDay)` runs the full day-interleaved loop: separation filter → per-consumer allocation against a transactional `AllocationLedger` → mount consumption (Chiga-Biga ×4) → shortfall recording with named cause → per-day `lastTickDay` commit, across an **N-day jump in one call** with **one consolidated summary**. Abstract mode: the resolver decrements day-count pool numbers.

**Tasks**
- `src/systems/SurvivalSystemAdapter.ts` (the **interface** only) + `src/systems/registry.ts` (resolve adapter by `game.system.id`, fall back to Generic). Core imports the interface, never a concrete adapter.
- A **minimal `Pf2eAdapter` stub** implementing only the verbs M2 needs: `getCreatureRation` (size→×1/×2/×4), `getGraceDays` (Con-mod+1), `isMount`, `needsConsumption` (false for dead/HP0/needs=0), and Abstract-mode `getAvailable`/`consume`/`grant` that read and write the registry's day-count numbers (no real inventory yet). `reconcileConsequences` is a **no-op stub** in M2 (filled in M3).
- `src/core/AllocationLedger.ts`: in-memory working copy of present pools; `draw(kind, units)` decrements immediately so two consumers can't both be told the pool is full. **Invariant: Σ draws ≤ initial availability.**
- `src/core/Resolver.ts`: source-order allocation (Communal-first default: mount/base → storage → own pack; Personal-first alternative). Mounts draw **own carried supply → storage only**, never a PC pack. Record shortfall (named cause) **only after the whole chain is dry**.
- `src/core/SurvivalEngine.ts`: the `runTick(targetDay)` loop per architecture §3.2 — `isPrimaryGM()` guard + world-backed re-entrancy lock; **day-interleaved** `for d in (lastTickDay+1 .. min(targetDay, lastTickDay+maxCatchUpDays))`; **per-group separation filter** (`withParty[group]===true`) applied *before* allocation; mount consumers included; commit `lastTickDay` per-day; emit one summary object (no UI yet — return structured data).
- **Separation enforced at the sourcing layer:** the filter removes separated pools from the allocation list before `new AllocationLedger(presentPools)`.
- **N-day / week advance:** `runTick(currentDay + N)` accrues each day in order; `N=7` is just the same loop. **Catch-up cap** (`maxCatchUpDays=14`): on overflow, surface a decision flag in the summary (montage vs lump) rather than silently under-charging.
- **Rewind** handling: backward clock move sets the pointer back without refunding; large backward jump emits a "new campaign? reset?" flag.
- **Dangling-UUID resilience:** a pool whose actor no longer resolves is skipped with a "supplies lost" note + cargo-disposition flag — never a throw.
- `src/core/LadderEngine.ts` **counters only** in M2: satisfied → reset `daysDeprived` to 0; deprived → increment and recompute `stage` (capped at 3 per Decision E). No condition application yet (that's M3) — but the stage numbers are computed and returned so M3 only has to map them.

**Files created:** `src/systems/SurvivalSystemAdapter.ts`, `src/systems/registry.ts`, `src/systems/Pf2eAdapter.ts` (partial), `src/core/AllocationLedger.ts`, `src/core/Resolver.ts`, `src/core/SurvivalEngine.ts`, `src/core/LadderEngine.ts`, `src/core/time.ts` (day arithmetic helpers), and tests: `test/ledger.test.ts`, `test/resolver.test.ts`, `test/engine.tick.test.ts`, `test/engine.separation.test.ts`, `test/engine.mount.test.ts`, `test/engine.multiday.test.ts`.
**Files touched:** `src/module.ts` (resolve adapter on `ready`; expose `api.runTick`).

**Acceptance (demoable from the dev console):**
- **Separation cliff:** flip Chiga-Biga `withParty["Main"]=false`, run a tick → personal packs only are drawn, the headline drops from "Water 9" to "Water 2", and each shortfall states "the base is separated."
- **Mount consumer:** with the base present in **Hot**, one tick charges Chiga-Biga **4 Rations + 8 Water** (Huge×4 × Hot×2 water); the base stockpile visibly drops.
- **Week advance:** `runTick(day+7)` against the Ssir-Kat fixture (base separated) returns **one** consolidated summary; a PC that goes dry on day 2 reaches the correct **stage 2/3** by day 7, not stage 1 (proves day-interleaving).
- **No double-spend:** a property test confirms Σ draws ≤ initial availability across randomized consumer orders.
- **Catch-up cap:** `runTick(day+40)` flags the montage/lump decision instead of charging 40 days silently.

**Dependencies:** M1.
**Size:** L.
**Key risks:** double-spend if the ledger isn't the single source of truth during a tick (mitigate: all draws go through `AllocationLedger`, property-tested); two-pointer desync on rewind (mitigate: single global `lastTickDay` + `joinedDay`, per architecture); re-entrancy from the Rest + world-time hooks (mitigate: world-state-backed lock — even though hooks land in M3, build the lock now).

---

## M3 — Consequence ladders + native pf2e conditions via `reconcileConsequences` + climate/warmth

**Goal:** Stages become real native PF2e conditions through the **one idempotent `reconcileConsequences(actor, allTracks)`** verb; conditions follow PF2e stacking (full union of stage signatures, highest value per repeated type — nothing dropped); climate multipliers and the one-checkbox warmth model drive the thirst/cold tracks.

**Tasks**
- Complete `Pf2eAdapter.reconcileConsequences`: implement the `STAGE_MAP` (hunger/thirst/cold → fatigued/enfeebled/drained/sickened/clumsy per mechanics §4); compute the **union** of demanded specs across all active tracks; diff against **only module-applied conditions** (provenance flag — never strip a Doomed from a curse/crit); call `increaseCondition`/`decreaseCondition` to reach the target. Implement `isWarmSourceEquipped` (auto-detect pf2e Cold-Weather Clothing).
- **Condition union (no cap):** union all active tracks' full stage signatures, taking the highest value for a repeated type (same-type never double-stacks); nothing is dropped to thin the list (architecture §1.2).
- **Stage-3 unhealable HP** (Decision D): set/clear `blockedHealing` flag at hunger/thirst stage 3; clears on fed/watered.
- **Decision E:** stages cap at 3 by default; stage 4 only when Dial 6 = "Climb to death."
- `src/core/ClimateModel.ts`: the 5-band table (Temperate/Hot/ExtremeHeat/Cold/ExtremeCold) → water ×1/×2/×3, thirst-grace −1 in Extreme Heat, cold-track on for Cold/ExtremeCold, firewood-per-night. Ship presets `coast_temperate`, `desert_hot`, `sunhills_temperate`, `northern_cold`, `default_temperate`. Per-group climate (a delve = Temperate under a desert).
- **Warmth resolution** in the tick: per-character "kept warm?" satisfied by warm clothing (auto) OR campfire (1 firewood for the whole camp) OR warm shelter (one click); zero firewood removes only the campfire option — never freezes a PC in warm clothing. Resolve warmth strictly **before** any cooking extra.
- Wire `LadderEngine` (M2 counters) → `reconcileConsequences` at commit time; recovery mirrors PF2e (step −1 per rested night).
- **Trigger wiring:** `updateWorldTime` hook → boundary math → `runTick`; Rest-for-the-Night + the Advance control → `runTick(current+N)` directly (do **not** route through `game.time.advance()`); the re-entrancy lock built in M2 now guards real concurrent triggers.

**Files created:** `src/core/ClimateModel.ts`, `test/adapter.reconcile.test.ts`, `test/ladder.test.ts`, `test/climate.test.ts`, `test/engine.warmth.test.ts`.
**Files touched:** `src/systems/Pf2eAdapter.ts` (complete), `src/core/LadderEngine.ts` (cap + recovery + blockedHealing), `src/core/SurvivalEngine.ts` (warmth step, reconcile at commit), `src/core/time.ts` (world-time boundary math), `src/module.ts` (register `updateWorldTime`/Rest hooks).

**Acceptance:**
- A Con +0 PC unwatered in Hot for 2 days shows native **Fatigued → Sickened 1** on the token HUD; recovering strips only what the other tracks don't still demand (shared-Fatigued bug fixed).
- A PC suffering hunger + thirst + cold carries each active track's conditions at once, same-type taking the highest value (no double-stacked Drained) — up to three conditions at the worst stages.
- Hunger/thirst stage 3 sets unhealable HP; eating/drinking clears it.
- A "kept warm" PC in a Cold band accrues **no** cold stage even with zero firewood; an unwarmed one does.
- Advancing the world clock a day fires exactly one tick (no double-advance against a calendar module).

**Dependencies:** M2.
**Size:** L.
**Key risks:** reconcile stripping conditions it didn't apply (mitigate: provenance flag, tested); pf2e `increaseCondition` API drift on v8.2.0 (mitigate: thin adapter wrapper, smoke-tested in a live world); double-advance via conflating survival-day with `game.time.advance` (mitigate: Rest/Advance call `runTick` directly).

---

## M4 — GM Control Panel (ApplicationV2)

**Goal:** The GM can do everything the engine supports from a real ApplicationV2 panel: read the headline, toggle `With party?` per pool, hit the **Delving preset**, edit pool numbers, set climate, see per-consumer **visible clocks**, and click **Advance Day / Week / N days**.

**Tasks**
- `src/apps/GmControlPanel.ts` (`HandlebarsApplicationMixin(ApplicationV2)`): headline readout; per-pool `With party?` toggles + one-click **Delving preset** (flips every mount+storage `withParty=false` atomically, offers Temperate for delvers); roster with per-consumer status, **visible clocks** ("Иримэ — unwatered, 2 of 3 grace days"), needs override, a red "no reachable supply" badge for mis-configured consumers; climate picker; **Advance Day / Week / N days** control.
- Click-a-number pool edits commit on **blur/Enter** (not per-keystroke); all writes route through `socketlib.executeAsGM` (uniform path).
- `src/net/socket.ts`: `executeAsGM` handlers for `runTick`, `setWithParty`, `editPool`, `setClimate`, `applyDelvingPreset`; each call awaited, "no GM online" rejection caught and surfaced.
- Templates + CSS.

**Files created:** `src/apps/GmControlPanel.ts`, `src/net/socket.ts`, `templates/gm-panel.hbs`, `styles/survival.css`.
**Files touched:** `src/module.ts` (open-panel control / scene control button).

**Acceptance:** GM opens the panel; clicking **Delving** greys out Chiga-Biga and the headline recomputes the cliff live; **Advance Week** runs the M2/M3 engine and the roster clocks update; editing "Water 16 → 20" persists and re-renders. All mutations survive a reload.

**Dependencies:** M3 (needs real ticks + conditions to display).
**Size:** L.
**Key risks:** ApplicationV2 render/hook churn on v13 vs v14 (mitigate: target v13+ AppV2 only, smoke-test both); socket round-trips feeling laggy (mitigate: optimistic re-render + reconcile on confirm).

---

## M5 — Players HUD + Upkeep card + green-day suppression + consolidated multi-day summary

**Goal:** Players get a read-mostly HUD with their own "Kept warm?" checkbox; the daily Upkeep card appears **only on a shortfall or real choice** (green days are a silent whisper from day one — Decision F); a multi-day advance shows **one** card with the consolidated summary.

**Tasks**
- `src/apps/PartyHud.ts`: pool headline + per-PC track icons + each player's own **"Kept warm tonight?"** checkbox (writes the separate `.warmth` flag via `executeAsGM`). Separated pools render greyed with a tag.
- `src/apps/UpkeepDialog.ts`: the single card — need vs available vs source used, every shortfall with named cause, firewood row only when relevant, warmth row, one **Confirm** pre-filled with the auto-resolution. Split parties = **one card, two sections, single Confirm** (Dial 7).
- **Green-day suppression:** when Dial 3 = "only when wrong" AND all-green, emit a silent whisper and **never open** the dialog (Decision F, on from day one).
- **Consolidated summary:** the M2 N-day summary object renders as one card/whisper, not seven; named-cause shortfalls + visible per-character clocks.
- Private per-player nudges (whispers), never public shaming.
- Sheet injection (`renderActorSheetV2`/`renderItemSheetV2`): "Kept warm" checkbox on PCs; (item dropdown deferred to M8 Ledger).

**Files created:** `src/apps/PartyHud.ts`, `src/apps/UpkeepDialog.ts`, `src/apps/sheet-injection.ts`, `templates/party-hud.hbs`, `templates/upkeep.hbs`.
**Files touched:** `src/core/SurvivalEngine.ts` (emit summary → UI hook), `src/net/socket.ts` (warmth + confirm handlers), `styles/survival.css`.

**Acceptance:** A fully-green Advance-a-Day produces **no dialog** (only a whisper); a shortfall day opens exactly one Upkeep card with the named cause; **Advance Week** with a mid-week shortfall opens **one** consolidated card; a player toggling "Kept warm" updates their own warmth without the GM's `state` write clobbering it.

**Dependencies:** M4.
**Size:** L.
**Key risks:** player owner-write clobbering GM state (mitigate: separate `.warmth` flag key + all writes via `executeAsGM`); whisper spam on multi-day (mitigate: single consolidated emit).

---

## M6 — Optional extras (foraging, hot meal)

**Goal:** The Dial-9 extras framework + the two most useful extras, off by default, on for wilderness/desert arcs.

**Tasks**
- `src/core/extensions/` framework: each extra is a `SurvivalExtension` (`onTick`, `onUpkeepDialog`, `registerSettings`) the engine iterates **when enabled**; discretionary extras carry `runForCatchUp:false` (a 14-day montage doesn't roll 14 foraging checks).
- **Foraging** (Dial 8): once/day Survival check via the adapter's optional `rollForage` (crit feeds 2, success 1, fail = Fatigued); replenishes the communal pool.
- **Hot meal:** +1 firewood upgrades the day's rations into a small expiring buff; **warmth always wins the firewood** if both compete.
- Optional "Next water in N days" desert countdown (pure display) — cheap, high value for the current desert hero scenario.

**Files created:** `src/core/extensions/index.ts`, `src/core/extensions/foraging.ts`, `src/core/extensions/hotMeal.ts`, `test/extensions.test.ts`.
**Files touched:** `src/core/SurvivalEngine.ts` (iterate enabled extensions), `src/systems/Pf2eAdapter.ts` (`rollForage`), `src/settings.ts` (extra toggles).

**Acceptance:** With foraging on, a tick rolls one Survival check and credits the pool; a 7-day advance rolls foraging **zero** times for catch-up days (`runForCatchUp:false`); enabling hot meal consumes the extra firewood only after warmth is satisfied.

**Dependencies:** M3 (tick), M5 (upkeep card hooks).
**Size:** M.
**Key risks:** extras leaking into the catch-up loop (mitigate: `runForCatchUp` flag, tested); firewood contention order (mitigate: warmth-before-cooking invariant, tested).

---

## M7 — i18n (en + ru)

**Goal:** Full `en` + `ru` locales shipped together (Decision I), with whole-sentence keys, Russian plural rules, and a missing-key guard.

**Tasks**
- Extract every user-facing string to `SURVIVAL.`-prefixed keys; **whole sentences with placeholders**, never concatenated fragments (Russian word order). `game.i18n.format("SURVIVAL.Shortfall.separated", {name, kind, pool})`.
- `src/util/i18n.ts`: `Intl.PluralRules` / `Intl.NumberFormat` helper keyed to `game.i18n.lang` (Russian `one/few/many/other`); use `game.i18n.has` to detect misses (not `??`).
- Fill `lang/en.json` + `lang/ru.json`; honest-scope note in docs: module *flavor* labels localized, the underlying pf2e condition name shows in pf2e's own localization.
- **Item-match list** stays a locale-independent world setting, **not** in `lang/*.json`.

**Files created:** `src/util/i18n.ts`, `test/i18n.test.ts`.
**Files touched:** `lang/en.json`, `lang/ru.json`, every `apps/*` template + string call site.

**Acceptance:** Switching Foundry's core language to Russian renders all module UI in Russian with correct plurals (1 день / 2 дня / 5 дней); a deliberately removed key surfaces the key name (caught by the `has` guard), not a silent blank.

**Dependencies:** M4–M6 (strings must exist to extract).
**Size:** M.
**Key risks:** fragmented strings breaking ru word order (mitigate: whole-sentence keys, reviewed); `??`-on-miss masking gaps (mitigate: `game.i18n.has`).

---

## M8 — Ledger mode (v2) + compendium seeding

**Goal:** The flagship **Ledger** mode — pools are real Actor inventories the adapter decrements — behind Dial 1, with the same headline and UI. Seed the `Water (day)` / `Firewood (bundle)` compendium items.

**Tasks**
- Complete `Pf2eAdapter` inventory verbs against real items: `getResourceLots`/`getAvailable` reading actor inventory; `consume` handling the **7-ration decomposition** + per-system quantity path (batched); `grant`; honor the **per-item override flag first**, then slug/trait/type heuristic, then the configurable match list.
- `packs/`: seeded compendium items "Water (day)", "Firewood (bundle)"; module seeds them on first Ledger enable.
- Item-sheet dropdown (`renderItemSheetV2`): "Survival resource: food/water/firewood" sets the per-item override flag (homebrew escape hatch).
- Dial 1 toggles Abstract ↔ Ledger with **no UI change** — same `getHeadline`, same panel; only the adapter's read/write path differs.
- Migration: Abstract day-counts → seeded Ledger items on switch (GM-confirmed).
- **Single-point-of-failure handling** hardened: "the mount died with all supplies on it" → lost/looted/dropped GM prompt (the dangling-UUID path from M2 gets its real cargo-disposition UI here).

**Files created:** `packs/survival-items/…`, `test/adapter.ledger.test.ts`, `test/adapter.decompose.test.ts`.
**Files touched:** `src/systems/Pf2eAdapter.ts` (real inventory), `src/apps/sheet-injection.ts` (item dropdown), `src/settings.ts` (Ledger seeding), `src/core/migrations.ts` (Abstract→Ledger).

**Acceptance:** Flipping Dial 1 to Ledger keeps the headline identical but now a tick decrements a real "Rations" item (a 1-week ration becomes 7 day-units); a homebrew "Canteen" tagged via the item dropdown counts as water; the mount dying prompts cargo disposition rather than crashing.

**Dependencies:** M2–M5 (Abstract engine + UI), M7.
**Size:** L.
**Key risks:** ration decomposition off-by-one against pf2e item quantity semantics (mitigate: `adapter.decompose` unit tests); double-decrement vs the in-memory ledger (mitigate: ledger computes net deltas, single batch-commit).

---

## M9 — Polish + release

**Goal:** Migrations hardened, accessibility/UX pass, docs, and a tagged release with auto-update.

**Tasks**
- Two-level `dataVersion` migrations tested from **empty and populated** worlds; lazy per-actor flag migration; `ready` reconciliation (catch up to current world-day if a day passed with no GM online); **cross-campaign reset action** (zeroes `lastTickDay` + every actor's counters — the vault is reused).
- Rewind UX: large backward jump → "new campaign? reset survival tracking?" prompt.
- A11y/keyboard pass on all four AppV2 surfaces; HUD density client setting; panel-collapsed client setting.
- README, GM quickstart, the dnd5e-adapter "replaces SRD survival" caveat doc, the honest-scope localization note.
- Bump `version` + `compatibility.verified` together; tag → `release.yml` zips, publishes manifest/download pair.
- End the release report with the **at-a-glance ✅ status-line block** (per the saved version-report format).

**Files touched:** `src/core/migrations.ts`, `src/module.ts` (ready reconciliation + reset action), all `apps/*`, `README.md`, `module.json`.

**Acceptance:** A populated v1 world migrates clean; a day passing with no GM online catches up on next GM `ready`; the cross-campaign reset zeroes everything; a tagged release auto-updates in Foundry's package manager.

**Dependencies:** all prior.
**Size:** M.
**Key risks:** migration data loss (mitigate: backup-before-migrate + empty-and-populated tests); ready-reconciliation double-charging (mitigate: idempotent `lastTickDay`).

---

## Testing strategy

**Headless unit / property tests (Vitest) — the engine is fully testable without Foundry.** Adapter/Foundry boundaries are mocked; core takes plain data.

| Target | Tests |
|---|---|
| `AllocationLedger` | Σ draws ≤ initial availability (property test, randomized consumer order); no double-spend; exact-drain edge. |
| `Resolver` | Communal-first vs Personal-first order; mount draws own→storage only, never a PC pack; shortfall recorded only after full chain dry, with named cause. |
| `SurvivalEngine.runTick` | day-interleaved escalation (dry on day 2 → correct stage by day 7); single consolidated summary; `lastTickDay` committed per-day; catch-up cap flags montage/lump; rewind sets pointer without refund; dangling-UUID skipped not thrown; re-entrancy lock serializes. |
| **Separation filter** | a `withParty=false` pool is absent from the allocation list (sourcing-layer, not UI); Delving preset flips all atomically; headline cliff recomputes. |
| **Mount consumer** | Chiga-Biga Huge×4 × Hot×2 = 4 food / 8 water; mount deprivation defaults narrate-only; per-mount opt-in to auto-conditions. |
| `LadderEngine` | grace = Con-mod+1; thirst faster than hunger; cap at stage 3 (Decision E); recovery steps −1/night; blockedHealing set/clear at stage 3. |
| `reconcileConsequences` | union across tracks; shared-Fatigued not stripped on partial recovery; provenance — never strips non-module conditions; same-type takes highest value (no double-stack). |
| `ClimateModel` | water ×1/×2/×3; thirst-grace −1 in Extreme Heat; cold track on for Cold/ExtremeCold; per-group climate. |
| Warmth | warm clothing/campfire/shelter each suppress cold; zero firewood doesn't freeze a clothed PC. |
| Extensions | `runForCatchUp:false` skips montage days; warmth-before-cooking firewood order. |
| i18n | ru plural categories; `game.i18n.has` miss detection. |
| Ledger adapter (M8) | 7-ration decomposition; per-item override precedence; net-delta single commit. |
| Migrations (M9) | empty + populated worlds; cross-campaign reset. |

**Manual Foundry smoke tests (per milestone — a live v14 + pf2e v8.2.0 world):**
- **M0:** module loads, no console errors, `api.ping()`, alive banner.
- **M1:** Caravan document created once; settings show locked defaults; pool edit persists across reload.
- **M2:** from the console — separation cliff, Chiga-Biga ×4 charge, `runTick(day+7)` one summary.
- **M3:** native Fatigued→Sickened on a token HUD; full-signature stacking holds (Frostbitten = Fatigued + Clumsy 2 + Drained 1); world-clock day fires exactly one tick (no double-advance).
- **M4:** Delving preset greys the base + headline cliff; Advance Week updates clocks; pool edit re-renders.
- **M5:** green day = no dialog (whisper only); shortfall day = one named-cause card; player "Kept warm" not clobbered by GM write.
- **M6:** foraging rolls once/day, zero on catch-up; hot meal consumes firewood after warmth.
- **M7:** core language → Russian renders all UI with correct plurals.
- **M8:** Ledger mode decrements a real Rations item; homebrew item via dropdown counts; mount-death cargo prompt.
- **M9:** populated-world migration clean; GM-offline day catches up on ready; cross-campaign reset zeroes.

---

## Definition of Done (template — apply per milestone/PR)

- [ ] All acceptance criteria for the milestone demonstrably pass (console or UI as specified).
- [ ] Unit/property tests added for new core logic; full suite green in CI.
- [ ] `npm run lint` clean — including the **no-`pf2e`-outside-`src/systems/`** rule (Pillar 1).
- [ ] `npm run typecheck` clean (adapter contract fully implemented — TS proves it).
- [ ] Manual Foundry smoke test for this milestone performed on v14 + pf2e v8.2.0; result noted in the PR.
- [ ] No new console errors/warnings on world load or during a tick.
- [ ] All player-facing strings are `SURVIVAL.`-prefixed keys (no hardcoded literals) — en + ru present once M7 lands.
- [ ] Shared-state writes route through `executeAsGM`; no direct owner-write of `state`.
- [ ] Locked decisions respected (Abstract-only in v1; cap at stage 3; green-day suppression; mount narrate-only default; waterskin=2; maxCatchUpDays=14).
- [ ] Docs/CHANGELOG updated; PR description lists files touched + the demo.
- [ ] Ends with the at-a-glance ✅ status-line block.

---

## First three PRs (start immediately)

**PR #1 — "Scaffold loads in Foundry" (M0).**
Repo init; `module.json` (no `maximum`); Vite build → `scripts/module.js`; `src/module.ts` with `ready` banner + `api.ping()`; socketlib registered in `socketlib.ready`; ESLint `no-pf2e-outside-systems` rule; Vitest + one passing test; `ci.yml` + `release.yml`.
*Done when:* the module loads clean in v14, `api.ping()` returns `"pong"`, CI is green.

**PR #2 — "Caravan registry + dials + headline" (M1).**
`CaravanStore` on a hidden JournalEntry (UUID refs, queued atomic `update()`); `settings.ts` with all dials at locked defaults + `maxCatchUpDays=14`; per-actor `state`/`warmth` flag schemas; `getHeadline(group)` in Abstract mode wired to `api`; The Shards fixture builder + `caravan.test.ts`.
*Done when:* registry auto-creates once, `api.getHeadline("Main")` is correct, a pool edit persists across reload.

**PR #3 — "Engine heart: ledger + resolver + separation + mount + tick, headless" (M2 core slice).**
`SurvivalSystemAdapter` interface + registry + minimal Abstract `Pf2eAdapter` stub; `AllocationLedger`; `Resolver` (Communal-first + mount own→storage); `SurvivalEngine.runTick` with the day-interleaved N-day loop, **separation filter at the sourcing layer**, per-day `lastTickDay` commit, catch-up cap; `LadderEngine` counters (cap 3, no conditions yet). Tests: ledger property test, separation, mount ×4, multi-day escalation.
*Done when (console-demoable):* the separation cliff, the Chiga-Biga ×4 Hot charge, and `runTick(day+7)` → one consolidated summary all pass headlessly — the three differentiators are exercised on day three of building.

---

*Sequencing rationale:* the walking skeleton (M0) proves the pipeline; the registry (M1) gives state; then the **differentiators land in M2/PR #3** — separation, mount-as-consumer, and N-day advance are unit-tested before any condition or UI exists, so the riskiest, most distinctive logic is validated first and everything after it is incremental.
