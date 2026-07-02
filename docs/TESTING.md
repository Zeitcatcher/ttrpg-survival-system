# Smoke-testing v0.6.0 in Foundry

Covers the engine (M0–M3) + GM panel (M4) + **player HUD & daily upkeep card (M5)** + **foraging & hot meal (M6)** + **Ledger supply mode (M8)** + the **v0.3–0.4 GM-play additions** (reset, member/base chips, remove, transfer, fungible provisions). The engine is unit-tested headless (62 tests); this pass verifies the **Foundry-coupled layer** in a real world. Test as the **GM** (and, for the HUD, as a player if you can).

## 1. Install
1. Foundry **v13 or v14**, a **Pathfinder 2e** world.
2. Install **socketlib** (required): Add-on Modules → Install Module → search "socketlib".
3. Install this module by **Manifest URL**:
   `https://github.com/Zeitcatcher/ttrpg-survival-system/releases/latest/download/module.json`
4. **Game Settings → Manage Modules** → enable **socketlib** and **TTRPG Survival System** → Save.

> If you installed an earlier build, click **Update** so you get v0.6.0.

## 2. Sanity check
- Console (**F12**) on load: `ttrpg-survival-system | ready (system adapter: pf2e)` + a **"Survival module loaded."** toast.
- **Configure Settings → TTRPG Survival System**: the dials are there (Supply detail, Upkeep prompt, Source priority, Climate, Foraging, Forage DC, Next water, Catch-up cap…).
- **Open the GM panel:** click the single **Survival** (campground) button in the Token Controls toolbar — as GM it opens the panel — or `game.modules.get("ttrpg-survival-system").api.openPanel()`. *(There's now one survival button per user, not two.)*
- **Read the header (v0.6.0):** the top shows **"Party supply — pooled · N"** (N = consuming creatures), a **climate-effects line** ("Hot — water ×2 · no firewood"), then Food/Water/Firewood each as **days of supply** with the `stored ÷ need/day` math and a colour (green 3+, amber 1–2, red 0, grey — not needed). Below, **"Counted from:"** chips list every pool feeding the number; a **base/mount left behind is struck through** and labelled "left behind" — that's the number dropping because its stores stopped counting. The same header appears on the player HUD.

## 3. Core loop
1. Put **2–3 PC tokens** on a scene, **select them**, and click **"+ Add selected tokens"** → they appear in the **Roster**.
2. For each **Personal pack**, click the **💧** and **🍖** numbers and set both to **2**.
3. Click the **Hot** climate band, then **Advance Week**.
4. **Expected:** pool numbers drop; roster **clocks** climb (e.g. `Thirst 2/3`); once past the grace window a **native PF2e condition** lands on the token (**Fatigued → Sickened/Enfeebled → Drained**); the headline reflects days-of-supply.
5. **Recover:** set water/food back up → **Advance Day** → clocks reset, conditions step down.

## 4. The upkeep card (M5)
- **Green day:** with a well-supplied party, **Advance Day** → **no card**, just a quiet GM whisper in chat ("everyone fed, watered, and warm"). *(This is the "green days vanish" behaviour; controlled by the Upkeep prompt setting.)*
- **Shortfall day:** starve someone (empty their water), **Advance Week** → **exactly one** GM card, **grouped by character**: each affected creature is its own section listing what it went without (with the named cause) and its current hunger/thirst/cold clocks. No separate per-player messages — one readable card is the whole report.

## 5. Player HUD + warmth (M5)
- Open the **party HUD**: a **player** clicks the same **Survival** button (for a non-GM it opens the HUD). As GM, preview it with `api.openHud()`. It shows the headline + each member's worst status.
- **Warmth:** set climate to **Cold**. On the HUD, a **"kept warm?"** button appears on characters you own. Click it → it routes to the GM via socketlib and flips to **"warm"**; advancing days then **won't** accrue cold on that character (an unwarmed one will get Chilled → Numb…).
- *(Test the socket properly with an actual second player logged in, toggling their own PC.)*

## 6. Foraging + water countdown (M6)
- Turn **Foraging = on** (settings). A small **🌿** button appears next to each creature in the roster. Click it → it rolls that actor's **Survival** check (you'll see the roll in chat) and, on success, **adds food** to the shared pool (crit = 2 days, success = 1).
- Set **Next water (days)** in settings to e.g. **5** → the panel header shows **"Next water: 5"**, which **counts down** as you Advance.
- Turn **Hot meal = on** (settings). A **Cook hot meal** button appears in the Pools header. Put some **🔥 firewood** on a mount/base pool, then click **Cook** → 1 firewood is spent and each member gains a **"Hot Meal"** effect + **temporary HP** (≈ their level). Check the token's effects/temp HP. *(A GM can point the "Hot meal effect (UUID)" setting at their own effect instead.)*

## 7. Members, bases, removal (v0.4.0)
- Under each roster name are **two independent chips**: **party member** (consumes food/water daily) and **base** (its supply is shared stock). Both ON = a living base like **Chiga-Biga** (still eats ×4); **base only** = a structure that consumes nothing (row shows *"not consuming"*, and it disappears from the player HUD).
- **✕ next to a name** removes the creature from tracking (confirm dialog): its pool goes too, and the module's conditions are stripped from the token.
- **"+ Add base"** (Pools header) creates a standalone stockpile; standalone pools get their own **✕**.
- **Reset** (Roster header) clears every member's hunger/thirst/cold and removes module-applied conditions — supplies and the day count stay.

## 8. Transfer supplies (v0.4.0)
- Each pool row has a **⇄** button → pick the target pool, the resource (food/water/firewood), and the amount. Sharing is **always deliberate** — the engine never auto-drains one PC's pack for another.
- In Ledger mode the transfer moves **real items** (consume on the source actor, grant on the target); day-count pools just adjust numbers. Mixed transfers (PC → standalone base) work too.

## 9. Separation + mounts (advanced)
- Put supplies on a base/mount pool, then toggle its **With party** off (or hit **Delving**): the pool greys, the headline **drops** (the "cliff"), and shortfalls name the separated base. Consumption scales with the **real size trait**: Large ×2, Huge ×4, **Gargantuan ×8** — and the roster shows the actual size name.

## 10. Ledger supply mode (M8; DEFAULT since v0.4.0)
- **Supply detail = Ledger** is the **default** — pools read **real inventory**; the panel header shows which mode is active. Worlds that saved Abstract without ever typing counts are **auto-switched once** on load (you'll see a notification). Prefer typed day-counts? Switch back to Abstract.
- **Food = the native pf2e Rations item.** Just give a token real **Rations** (from the SRD compendium) and they count. When the module *adds* food — foraging, click-to-edit a pool up, a transfer — it **creates or tops up a native Rations item**, never a bespoke "Ration (day)". (Point the *Rations item (UUID)* setting at a specific item to clone a particular one.)
- **Native pf2e Rations = 7 FOOD charges** (one week each) — never water. A stack's quantity drops as weeks are eaten through, day by day; a partially-added stack carries a hidden day-counter so the exact day-count is preserved (so granting 8 food shows Rations ×2 with 6 days pre-used = 8 available).
- **Water / Firewood** have no per-day pf2e standard, so those stay module items — run `api.seedSupplies()` (or reload) to get **"Water (day)" / "Firewood (bundle)"** in the Items sidebar, or **tag any item** via the sheet's **"Survival resource"** dropdown (food/water/firewood).
- **Add** the token to the caravan → the panel's pool numbers read **from its inventory**. **Advance** → the actual item quantities **drop**. Click-to-edit a pool number grants/consumes real items to match.
- Numbers look wrong? Run `game.modules.get("ttrpg-survival-system").api.diagnose()` (F12 console) — it prints the mode, every pool's actor link, live counts, and how each inventory item was classified.

## 11. Create Water (v0.5.0)
- Give a caster the **Create Water** spell, **prepared** (or a spontaneous slot / innate use). Merely knowing it is not enough.
- Empty the party's water and hit **Advance Day**. A dry-run detects the coming thirst and:
  - the **owning player** (if online) gets a *"Conjure water?"* dialog;
  - the **GM** gets a coordination dialog listing every eligible caster — you can decide any row yourself (**Cast/Skip**), which **closes the player's prompt**; offline owners are GM-only rows.
- Confirming **expends the slot/use and posts the spell card** to chat, then the tick runs with **+8 water for that day** (2 gallons × 4 units; configurable). On a **Week** advance the consent applies to each day of the span.
- **Expiry rule:** conjured water not drunk that day **evaporates** — check that no pool number went *up* after the tick.
- Settings: *Water spells* (on/off), *Water per cast*, *Water spell slugs* (add homebrew slugs, comma-separated). Note: prompts fire from the panel's **Advance** buttons (world-clock time changes tick without prompting).

## What to report back
- Any **red console errors** (F12) — especially opening the panel/HUD, Add selected, editing a pool, Advance, the warm toggle, or Forage.
- Do the **panel and HUD render** and respond? Do **conditions apply/clear** on tokens? Does the **card** appear only on shortfall days? Does the **warm toggle** actually reach the GM (socketlib)?
- Anything that looks off.

**Note:** switching **Abstract ↔ Ledger** doesn't convert existing supplies — pick a mode, then stock it (Abstract numbers / Ledger inventory). Remaining polish (not bugs): Russian plural forms and save-data migrations (M7 / M9).
