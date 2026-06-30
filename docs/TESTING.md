# Smoke-testing v0.1.2 in Foundry

This is the **first build with a UI** (engine M0–M3 + the GM panel M4). The engine is unit-tested headless (45 tests); this pass verifies the **Foundry-coupled layer** in a real world. Test as the **GM**.

## 1. Install
1. Foundry **v13 or v14**, a **Pathfinder 2e** world.
2. Install **socketlib** (required): Add-on Modules → Install Module → search "socketlib".
3. Install this module by **Manifest URL**:
   `https://github.com/Zeitcatcher/ttrpg-survival-system/releases/latest/download/module.json`
4. In the world: **Game Settings → Manage Modules** → enable **socketlib** and **TTRPG Survival System** → Save.

> If you'd installed an earlier build, click **Update** (or uninstall + reinstall) so you get v0.1.2.

## 2. Sanity check (1 min)
- Open the browser console (**F12**). On load you should see:
  `ttrpg-survival-system | init — settings registered`, then `ttrpg-survival-system | ready (system adapter: pf2e)`, and a toast **"Survival module loaded."**
- **Game Settings → Configure Settings → TTRPG Survival System**: the dials should be there (Supply detail, Upkeep prompt, Source priority, Climate, Lethal deprivation, Split party, Foraging, Catch-up cap…).
- **Open the panel:** the **campground icon** in the left token toolbar, or run a macro / console: `game.modules.get("ttrpg-survival-system").api.openPanel()`. It should open and say *"No caravan yet."*

## 3. Core loop (the important one)
1. Put **2–3 PC tokens** on a scene and **select them**.
2. In the panel, click **"+ Add selected tokens"** → they appear in the **Roster**.
3. For each one's **Personal pack** pool, click the **💧 water** number and set it to **2**, the **🍖 food** to **2** (click-to-edit opens a dialog).
4. Click **Advance Week**.
5. **Expected:**
   - Pool numbers drop each day; the **roster clocks** climb (e.g. `Thirst 2/3`).
   - Once a creature is past its grace window, a **native PF2e condition appears on its token** — **Fatigued** first, then **Sickened/Enfeebled**, then **Drained** (check the token's condition icons / character sheet).
   - The **headline** (Food · Water · 🔥) reflects days-of-supply.
6. **Recover:** set a creature's water/food back up, **Advance Day** → the clock resets and conditions step down/clear.

## 4. Climate
- Click the **Hot** climate band → advance a day → **water should drain twice as fast** (need ×2). Try **Cold** → a "kept warm" requirement appears (no firewood → cold conditions accrue). *(The per-player warm toggle is M5; for now cold simply accrues.)*

## 5. Separation + mounts (optional, advanced)
- **Mounts / shared base** need an actor flagged as a mount. Before adding it, run this macro once (script macro) with the mount token selected:
  `canvas.tokens.controlled[0].actor.setFlag("ttrpg-survival-system","isMount",true)`
  Then **Add selected tokens** — it becomes a **mount/storage** pool. A **Huge** creature auto-consumes **×4** (size-based; no flag needed for that).
- Put supplies on the mount's pool, then toggle its **With party** off (or hit **Delving**): the pool greys out, the headline **drops** (the "cliff"), and shortfalls are attributed to the separated base.

## What to report back
This layer hasn't run in a live world yet, so anything counts:
- Any **red errors** in the F12 console (copy the text) — especially around opening the panel, "Add selected tokens", editing a pool, or Advance.
- Does the **panel render** and are the buttons clickable? Do **conditions actually apply/clear** on tokens?
- Anything that looks wrong or unclear in the UI.

Known-not-built-yet (don't report as bugs): player HUD + the "kept warm" checkbox, the daily upkeep card, foraging/hot-meal, real-inventory (Ledger) mode. Those are M5+.
