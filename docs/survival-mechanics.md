# Survival Mechanics — Design Spec (for review)

> **Status: DRAFT for discussion.** This is **step 1** — the game-design layer. Read, react, refine. Once we lock this, the [architecture](architecture.md) (step 2) follows. Nothing here is implemented yet.
>
> First target: **Pathfinder 2e (Remaster)**, campaign **The Shards**. Default language English; localization-ready.

---

## 0. Design philosophy

This is a **secondary, immersive system** — it should make the party *think about supplies* without becoming the game. Three rules guided every choice:

1. **The computer does arithmetic; humans make only fiction decisions.** A normal day is one click, or zero.
2. **Lean by default, rich on demand.** Everything heavier than the core loop is a toggle (a "dial"), off unless the GM wants it.
3. **Legible tension, not a death spiral.** Scarcity should produce *decisions and scenes*, not silently disable a PC more thoroughly than a boss fight. Clocks are visible; consequences are capped (a secondary system must never TPK by accident).

The three adversarial reviews of the first draft pushed hard on #3 — the revisions below (visible per-character clocks, capped condition stacking, mounts as pool-only by default, Abstract supply mode as the launch default) come from that.

---

## 1. The complexity dials (global GM settings)

The whole system tunes from **featherweight** to **full simulation** via a handful of world settings. Recommended launch defaults for The Shards in **bold**.

| # | Dial | Options | Default | What it changes |
|---|---|---|---|---|
| 1 | **Supply Detail** | `Abstract` ↔ `Ledger` | **Abstract (v1)** | `Abstract` = each pool is a day-count you click to edit — can't corrupt inventory, ships first. `Ledger` = pools are *real actor inventories* the engine decrements (the flagship "draws from the right pool" mode; hardened as v2). Same headline, same UI either way. |
| 2 | **Tracked needs** | pick any of Food / Water / Firewood | **Food + Water + Firewood-for-warmth** | Water always earns its keep; Food is a stated requirement; Firewood is an *enabler* (warmth/cooking), not a fourth ladder. |
| 3 | **Upkeep prompt** | `Always show` / `Only when something's wrong` | **Only when wrong** | A fully-green day auto-confirms to a silent whisper and never opens a dialog. The dialog appears only when there's a shortfall or a real choice. |
| 4 | **Source mode** | `Personal-first` / `Communal-first` | **Communal-first** | Whether the resolver drains personal packs or shared pools first. Communal fits a party treasury that lives on the mount/base. |
| 5 | **Climate model** | `Off` / `Manual band` / `Read weather module` | **Manual band** | `Off` disables water-scaling and the cold track (temperate campaigns). Manual = GM picks a band per region/group. Auto = read Simple Weather / Seasons & Stars if installed. |
| 6 | **Lethal deprivation** | `Cap at Stage 3` / `Climb to death` | **Cap at Stage 3** | Whether deprivation can reach a terminal lethal stage. Off by default — accidental death has no place in a secondary system. |
| 7 | **Split-party groups** | `Single party` / `Named groups` | **Single party** | Single = one "with party?" toggle per pool (covers ~95% of tables). Named = per-creature group tags for true simultaneous splits. |
| 8 | **Foraging** | `Off` / `On` | **On for wilderness arcs** (else Off) | The *replenish* counterpart to consumption (a Survival check that feeds the party). Genuinely useful on long overland travel; pure overhead in a dungeon. Recommend on only when travel needs a supply answer. |
| 9 | **Other extras** | per-toggle (§9) | **all OFF** | Hot meal, rest quality, sleeplessness, encumbrance, spoilage, morale — dark until an arc asks for them. |

**The promise:** dials at lean settings = a click-a-number, one-need-that-matters tracker. Dials cranked = a full inventory-decrementing caravan simulation. Same engine.

---

## 2. Resources & units

Three tracked things. **Firewood is an enabler, not a need** — it does something (warmth, cooking) or it's invisible.

| Resource | Unit | "1 unit" = | PF2e mapping (Ledger mode) |
|---|---|---|---|
| **Food** | Ration | one creature, one day | Native "Rations" item is 1 week → the adapter decomposes it to **7 day-units**. |
| **Water** | Water | one creature, one day | No native item — the module seeds a "Water (day)" item. A full waterskin = **2 Water** (one desert day) by default. |
| **Firewood** | Bundle | one camp, one night | No native item — the module seeds a "Firewood (bundle)." |

All three share the **creature-day** mental model, so the at-a-glance headline is always: **`Food 12 · Water 9 · 🔥 4`**. In Abstract mode those numbers *are* the stored values you click to edit; in Ledger mode they're computed from real inventory.

### Per-creature daily need

The only creature-level knob is a **size multiplier** (defaults ×1):

| Size | Food/Water ×mult | Example |
|---|---|---|
| Tiny / Small | ×1 (kept whole — no half-rations) | most small PCs |
| Medium | ×1 | most PCs |
| Large | ×2 | a warhorse |
| Huge+ | ×4 | a giant mount (GM-set; see §7) |
| **Non-eater** | needs = 0 | constructs, astral companions, the mephits |

> *Note:* the first draft used ×0.5 for Small with "round up at the pool" — the QA pass showed per-creature allocation makes that inconsistent. Small creatures eat a whole unit. Simplicity wins.

---

## 3. Consumption + the separation rule (the feature that earns the module's keep)

### When consumption happens
Once per in-game **day**, triggered by **any** of: a world-clock day crossing, a Rest-for-the-Night, or the panel's **Advance a Day / Advance a Week** button (or any N days) — all one code path, run once on the GM's client. Advancing several days at once accrues **each day's** consumption and escalation in order (a week of travel really burns a week of supplies) and reports a **single consolidated summary**, not seven dialogs.

### The resolver (source priority — Dial 4)

> **Communal-first (default):** mount/base pool → shared storage → own pack.
> **Personal-first:** own pack → mount/base pool → shared storage.

Each present creature pulls its (climate-modified) Food and Water down the chain, stopping when satisfied. A dry chain → that creature goes without → its clock ticks (§4). Mounts only ever draw from their own carried supply → storage (a mount doesn't raid a PC's backpack).

### The separation rule

Every non-PC pool (each storage, each mount) carries one **`With party?`** flag. **It is enforced in the math, not just the UI**: a separated pool is *removed from the allocation list before allocation*, so the engine literally cannot draw from supplies the party can't reach.

How the GM marks it:
- A prominent **"With party?"** toggle per pool in the GM panel.
- A **proactive prompt on the natural beat** — when the scene/region changes or the party declares a delve: *"Heading underground — is the base (Chiga-Biga) with the party? [Bring it down] · [Leave it on the surface]."* One click.
- A **"Delving" preset** that flips every mount + storage to *not with party* at once (and, optionally, sets the delvers' climate to underground — see §5).

What everyone sees:
- The separated pool greys out with a tag: *"Chiga-Biga — separated (left on the surface)."*
- The **headline recomputes live** — flipping the base off can drop "Water: 9 days" to "Water: 2 days" instantly. **That visible cliff is the tension the rule exists to create.**
- Every shortfall **states its cause**: *"Иримэ went unwatered — the base is separated. Thirst clock → 2 of 3 days."*

**Split parties (Dial 7 = Named groups):** each creature gets a group tag (default "Main"); a pool is "with party" *relative to a group*. The one honest cost: a genuine simultaneous split is two supply situations — but it's presented as **one card with two sections and a single Confirm**, never two dialogs. With Dial 7 = Single party (the default), this complexity disappears entirely.

This isn't hypothetical for The Shards: the **Ssir-Kat descent** (party went underground for ~3 days, leaving Chiga-Biga, Staf, and the mephits on the surface) is a literal in-canon example of exactly this rule.

---

## 4. Consequence ladders

**Design rules** (grounded in PF2e Remaster, which already models survival as automatic, save-less damage + conditions):

- Every stage maps to a **native PF2e condition** — it shows on the token HUD, respects immunities, and stacks correctly with the rest of the rules engine.
- **Grace period = Constitution modifier + 1 days** (PF2e canon), read automatically per actor. Thirst grace is shortened by heat (§5).
- **The clock is always visible per character** — *"Иримэ — unwatered, 2 of 3 grace days used."* A clock the player can't see is a gotcha, not tension.
- **Three stages by default.** Stage 1 is a *visible warning + minor condition*, not the hammer; the real bite lands at Stage 3. A terminal Stage 4 exists **only if Dial 6 = "Climb to death."**
- **No silent replacement — conditions follow PF2e stacking.** Each active track applies its **full** stage signature, and the tracks union together: different condition *types* coexist, while the *same* type from multiple tracks does **not** stack — the **highest value applies** (hunger-Drained 1 + cold-Drained 1 = Drained 1, not 2). So a deeply deprived character genuinely carries up to **three** conditions at once at the worst stages (e.g. Frostbitten = Fatigued + Clumsy 2 + Drained 1), and nothing is ever dropped to thin the list — conditions clear only as their stage recovers. *(Revised 2026-06-30: an earlier draft capped this to "Fatigued + one other," which wrongly made conditions vanish; the GM chose mechanical consistency.)*
- **Recovery mirrors PF2e:** eat/drink/get warm → escalation stops, the counter resets to 0, and stages step down (Fatigued clears on a fed/watered/warm night's rest; valued conditions step −1 per night). Recovery runs whenever the condition exists, even after the threat is gone.

Thirst escalates faster than hunger and bites harder in heat — mirroring PF2e's own 1d4/hour (thirst) vs 1/day (starvation) asymmetry. **Cold is the most forgiving** — one warm night resets it — so cold is *fun pressure*, not a death spiral.

#### HUNGER — the slow ladder
| Stage | Name | Trigger | Effect |
|---|---|---|---|
| 1 | **Hungry** | first day past grace | visible clock + **Fatigued** |
| 2 | **Famished** | +2 days | **Enfeebled 1** (Fatigued continues) |
| 3 | **Wasting** | +2 days | **Drained 1** (HP unhealable until fed) |
| 4 | *Starving* | prolonged (Dial 6 on) | Drained 2 + Doomed 1 |

#### THIRST — the fast ladder
| Stage | Name | Trigger | Effect |
|---|---|---|---|
| 1 | **Thirsty** | first day past grace (heat-shortened) | visible clock + **Fatigued** |
| 2 | **Dehydrated** | +1 day | **Sickened 1** (Fatigued continues) |
| 3 | **Failing** | +1 day | **Drained 1** (HP unhealable until they drink) |
| 4 | *Dying of Thirst* | prolonged (Dial 6 on) | Drained 2 + Doomed 1 |

#### COLD — the suppressible ladder (one checkbox makes it vanish)
Only accrues when **band ≥ Cold AND the character is not "kept warm"** (§5).
| Stage | Name | Trigger | Effect |
|---|---|---|---|
| 1 | **Chilled** | 1st unwarmed cold night | visible clock + **Fatigued** |
| 2 | **Numb** | +1 night | **Clumsy 1** (Fatigued continues) |
| 3 | **Frostbitten** | +1 night | **Clumsy 2 + Drained 1** |
| 4 | *Freezing* | prolonged / extreme cold (Dial 6 on) | Drained 2 + Doomed 1 |

> *Open decision:* the "HP unhealable until fed/watered" lever (Stage 3) is strong — it sidelines the party healer. Keep it for fidelity, or soften it? See §10, Q-D.

---

## 5. Climate & warmth

A region (or, with Dial 7, a group) sets **one climate band** — a 5-step collapse of PF2e's 9-band temperature table (daily granularity doesn't need nine). **Heat feeds thirst; cold drives the cold ladder.** There is no separate "heat need" — that two-axis confusion is the documented anti-pattern.

| Band | Water need | Cold track | Firewood for warmth | Example region |
|---|---|---|---|---|
| **Temperate** | ×1 | off | — | Побережье, Солнечные Холмы |
| **Hot** | **×2** | off | — | Пустыня |
| **Extreme Heat** | **×3**, thirst grace −1 day | off | — | desert high-noon / Пепельные пустоши |
| **Cold** | ×1 | **on unless warm** | **1 bundle/night** | Северные земли (Крагмир, Люменхольд) |
| **Extreme Cold** | ×1 | **on; +1 stage/unwarmed night** | **2 bundles/night** | high peaks (set-piece only) |

Ship presets: `coast_temperate`, `desert_hot`, `sunhills_temperate`, `northern_cold`, `default_temperate`. *Underground micro-climate:* a delve into a cave is usually Temperate even under a desert — the Delving preset offers to set the delvers' band to Temperate rather than inherit the surface's Hot.

### Warmth — dead simple, exactly as asked

Each character has one per-night **"Kept warm?"** check, satisfied by **any** of:
1. **Warm clothing** — the adapter auto-detects PF2e *Cold-Weather Clothing* (which by the rules negates severe-cold damage) and pre-ticks the box; otherwise one manual tick, set-and-forget.
2. **By a fire** — auto-satisfied for the **whole camp** if 1 firewood bundle is burned that night.
3. **Warm shelter** — e.g. the canon **warm-sand room** inside Chiga-Biga's base — a one-click "warm shelter."

Warm = cold track suppressed, full stop. No insulation math, no layers. Resolution is **per character**: zero firewood only removes the *campfire* option — it must never freeze a PC who is individually wearing warm clothing. (The "wet = one step colder" idea is unverified in PF2e canon, so it ships **off** as optional flavor only.)

---

## 6. Automation vs. manual

| Fully automatic | One-click, only when reality is ambiguous |
|---|---|
| Day-boundary detection + the tick (GM only) | **"Is the mount/storage with you?"** (prompted on a delve) |
| Con-mod → grace periods, per actor | **"Kept warm?"** per character (set-and-forget) |
| Resolver allocation, separation-filtered | Picking the **region/climate band** on travel |
| Supply decrement (real items in Ledger / day-counts in Abstract) | **Click any pool number** to edit (refill, "you found a stream", GM fiat) |
| Climate water multiplier; ration decomposition | Exclude a consumer ("Иримэ is fasting"); override draw order |
| Apply / escalate / clear native conditions | Tick "cook a hot meal"; un-tick "light a fire" |
| One whispered summary + private per-player clock nudges | The **Advance a Day / Week** button (or any N days) |

The **one dialog** (when it appears) shows each need as *need vs available vs source used*, every shortfall with its named cause, the firewood row only when relevant, a warmth row, and a single **Confirm** — pre-filled with the auto-resolution. On a green day with Dial 3 = "only when wrong," **it never opens.** Players get *private* nudges, never public shaming.

---

## 7. Mounts / pack animals

A mount is **both a consumer and a pool** — and Chiga-Biga is the proof case: a sentient giant larva that *is* the party's mobile base. One actor serves as mount **and** storage, so a single `With party?` toggle separates the beast and the entire stockpile at once.

**Default behaviour: mounts are real consumers.** Each mount eats and drinks by size (Large ×2, **Huge ×4**), drawing from its own carried supply → storage (never a PC's backpack). **Chiga-Biga = Huge ×4** — so the party must actually feed the giant larva, and in hot or cold country that draw is felt. Canon gives no consumption figure, so ×4 is a sensible size-based default, fully GM-editable (a one-click "off the books" remains available per mount if you ever want it).

Deprivation **consequences** for a mount default to **narrate-only** — the GM gets a flagged alert (*"Chiga-Biga is going hungry"*) rather than auto-stacked PF2e conditions on an NPC — with a one-toggle opt-in to full auto-applied conditions per mount.

Other handling:
- **Handler binding (cosmetic):** the panel names the mount's handler (**Ракакак** for Chiga-Biga) so whispers read *"Ракакак notes Chiga-Biga is getting hungry."*
- **Zero-need companions** (the mephits Квиззл/Свирп/Винг, the astral cat Guenhwyvar) ship as consumers with needs = 0 — the canonical "consumer with no needs" test cases.
- **Single point of failure:** because the base *is* the mount *is* the only stockpile, the engine must handle "the mount died with all the supplies on it" gracefully (lost / looted / dropped — a GM prompt), not crash. (Architecture detail, but flagged here because it's a real campaign risk.)

---

## 8. Worked example — the Ssir-Kat descent

**Party (group "Main"):** Иримэ, Вестник, Ракакак, Грог, Аранэя (5 PCs, Medium) + **Chiga-Biga** (mount + base, **Huge ×4 consumer**) + Staf + 3 mephits (needs 0). **Surface climate: Hot.** Source: Communal-first. **Pools on the base:** 20 Rations, 16 Water, 4 Firewood; each PC also carries ~7 Rations + a waterskin (2 Water).

1. **The split.** The party descends on foot. The upkeep prompts; the GM clicks the **"Delving — leave the base behind"** preset → Chiga-Biga (and its storage) → *not with party*; the delvers' band → Temperate (underground). The headline recomputes from personal packs only: **Food ~35 · Water 10 · 🔥 0.**
2. **Day 1 underground.** Communal-first wants the base first, but it's excluded, so each PC draws from their own pack. Food covered; Water covered (waterskins now empty). Firewood not needed (Temperate). **Card (whispered):** *"📦 The base is separated — drawing from personal supplies. Food 5/5, Water 5/5, waterskins now empty."* One Confirm.
3. **Day 2 — the shortfall bites.** Waterskins empty, base still separated. **Water 0/5.** Card: *"⚠️ No water — the base is separated on the surface. Thirst clocks advancing."* PCs with Con +2 (grace 3) are still on the clock; a Con +0 PC hits **Thirsty (Fatigued)** — and the card shows exactly *why now*.
4. **Resolution.** They climb out, reunite, the GM flips `With party?` back on. The next tick draws freely from the stockpile; everyone drinks; the clocks reset and Fatigued clears on the next rest.

*Meanwhile, topside:* the Camp group still has the base — but now must **feed Chiga-Biga**. Huge ×4 in Hot weather is 4 Rations + 8 Water/day, visibly drawing the base stockpile down (16 Water → 8 → dry on day 3), so even the group that kept the supplies feels the clock. This is exactly the pressure the "real consumer" choice adds.

**Total GM interaction across the arc:** the Delving preset, two Confirms, one reunion toggle. Everything else — draws, shortfall math, condition apply/remove — was automatic, with a named-cause card each day.

---

## 9. Optional extras (Dial 9 — all off unless turned on)

| Extra | Adds | Note |
|---|---|---|
| **Foraging / Subsist** | a once/day Survival check (crit feeds 2, success feeds 1, fail = Fatigued) that replenishes the communal pool — turns survival into a player verb | Dial 8; recommend on for wilderness arcs only |
| **Hot meal (cooking)** | +1 firewood upgrades the day's rations into a small expiring buff (à la Kingmaker camp meals) | gives firewood a second job; warmth always wins the firewood if both compete |
| **"Next water in N days"** | a desert countdown to the next oasis — pure display, drives tension | great for the desert arc |
| **Rest quality** | no shelter/fire halves HP recovery (PF2e already allows) | grittier travel |
| **Sleeplessness** | >16h awake → Fatigued (PF2e-native) | |
| **Supply encumbrance** | rations/water/firewood carry real Bulk | PF2e Bulk is mild — flavor, not a big lever |
| **Spoilage / bad water** | rations spoil after X days; bad water → Sickened | survival-horror tone |
| **Morale** | a party track nudged by deprivation and good meals | the most "fourth-need"-like; explicit opt-in |

---

## 10. Decisions — locked

Decided with the GM (2026-06-30). All as recommended **except C** (mounts are real consumers).

| # | Decision | Locked choice |
|---|---|---|
| A | Supply Detail at launch | **Abstract** (v1, ships first); Ledger is the hardened v2. |
| B | Default tracked needs | **Food + Water + Firewood**; Foraging on for wilderness arcs only. |
| **C** | **Chiga-Biga & mounts** | **Real consumers** — size-based (Large ×2, **Huge ×4** for Chiga-Biga), drawing from carried supply → storage. Deprivation is narrate-only by default (a GM alert), one-toggle opt-in to auto-conditions. *(changed from the recommendation)* |
| D | "Unhealable HP until fed/watered" | **Kept** at Stage 3 only, capped by Dial 6. |
| E | Lethal Stage 4 | **Capped at Stage 3**; Stage 4 reserved for explicit famine/exposure arcs. |
| F | Green-day dialog | **Auto-suppressed from day one** (silent whisper, no dialog). |
| G | Water calibration | **Waterskin = 2 Water** (one desert day). |
| H | Climate source | **Manual band** per region; weather-module auto-read later. |
| I | Locale at launch | **Ship `en` + `ru` together.** |
| J | Split-party | **Single-party default**; named-groups available. |
| + | **Time advance** | The GM can advance **a day, a week, or any N days** in one action; the engine accrues each day's consumption/escalation and reports one consolidated summary. |

These are now reflected throughout the spec above. Next: finalize the [architecture](architecture.md) and begin implementation.

---

*One-line summary:* a one-click daily upkeep that **vanishes on green days**, separation enforced in the math (with a visible supply "cliff" and named-cause shortfalls), three native-PF2e condition ladders with **visible per-character clocks and PF2e-correct condition stacking** (full signatures, highest-value-per-type), a one-checkbox warmth model, Chiga-Biga as a dual mount/storage pool that must itself be fed, **Abstract supply mode at launch** and Ledger as the flagship next step — lean by default, rich when you turn the dials up.
