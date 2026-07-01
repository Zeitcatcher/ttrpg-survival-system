# Smoke-testing v0.1.4 in Foundry

Covers the engine (M0–M3) + GM panel (M4) + **player HUD & daily upkeep card (M5)** + **foraging (M6)**. The engine is unit-tested headless (50 tests); this pass verifies the **Foundry-coupled layer** in a real world. Test as the **GM** (and, for the HUD, as a player if you can).

## 1. Install
1. Foundry **v13 or v14**, a **Pathfinder 2e** world.
2. Install **socketlib** (required): Add-on Modules → Install Module → search "socketlib".
3. Install this module by **Manifest URL**:
   `https://github.com/Zeitcatcher/ttrpg-survival-system/releases/latest/download/module.json`
4. **Game Settings → Manage Modules** → enable **socketlib** and **TTRPG Survival System** → Save.

> If you installed an earlier build, click **Update** so you get v0.1.4.

## 2. Sanity check
- Console (**F12**) on load: `ttrpg-survival-system | ready (system adapter: pf2e)` + a **"Survival module loaded."** toast.
- **Configure Settings → TTRPG Survival System**: the dials are there (Supply detail, Upkeep prompt, Source priority, Climate, Foraging, Forage DC, Next water, Catch-up cap…).
- **Open the GM panel:** the **campground** button in the token toolbar, or `game.modules.get("ttrpg-survival-system").api.openPanel()`.

## 3. Core loop
1. Put **2–3 PC tokens** on a scene, **select them**, and click **"+ Add selected tokens"** → they appear in the **Roster**.
2. For each **Personal pack**, click the **💧** and **🍖** numbers and set both to **2**.
3. Click the **Hot** climate band, then **Advance Week**.
4. **Expected:** pool numbers drop; roster **clocks** climb (e.g. `Thirst 2/3`); once past the grace window a **native PF2e condition** lands on the token (**Fatigued → Sickened/Enfeebled → Drained**); the headline reflects days-of-supply.
5. **Recover:** set water/food back up → **Advance Day** → clocks reset, conditions step down.

## 4. The upkeep card (M5)
- **Green day:** with a well-supplied party, **Advance Day** → **no card**, just a quiet GM whisper in chat ("everyone fed, watered, and warm"). *(This is the "green days vanish" behaviour; controlled by the Upkeep prompt setting.)*
- **Shortfall day:** starve someone (empty their water), **Advance Week** → **one consolidated card** to the GM listing who went without + the **named cause** + clocks, and each affected **player gets a private nudge** whisper.

## 5. Player HUD + warmth (M5)
- Open the **party HUD**: the **heart-pulse** button in the token toolbar (visible to players too), or `api.openHud()`. It shows the headline + each member's worst status.
- **Warmth:** set climate to **Cold**. On the HUD, a **"kept warm?"** button appears on characters you own. Click it → it routes to the GM via socketlib and flips to **"warm"**; advancing days then **won't** accrue cold on that character (an unwarmed one will get Chilled → Numb…).
- *(Test the socket properly with an actual second player logged in, toggling their own PC.)*

## 6. Foraging + water countdown (M6)
- Turn **Foraging = on** (settings). A small **🌿** button appears next to each creature in the roster. Click it → it rolls that actor's **Survival** check (you'll see the roll in chat) and, on success, **adds food** to the shared pool (crit = 2 days, success = 1).
- Set **Next water (days)** in settings to e.g. **5** → the panel header shows **"Next water: 5"**, which **counts down** as you Advance.

## 7. Separation + mounts (advanced)
- Flag a mount before adding it (script macro, mount token selected):
  `canvas.tokens.controlled[0].actor.setFlag("ttrpg-survival-system","isMount",true)`
  Then **Add selected tokens** → it's a **mount/storage** pool. A **Huge** creature auto-consumes **×4** (size-based).
- Put supplies on the mount's pool, then toggle its **With party** off (or hit **Delving**): the pool greys, the headline **drops** (the "cliff"), and shortfalls name the separated base.

## What to report back
- Any **red console errors** (F12) — especially opening the panel/HUD, Add selected, editing a pool, Advance, the warm toggle, or Forage.
- Do the **panel and HUD render** and respond? Do **conditions apply/clear** on tokens? Does the **card** appear only on shortfall days? Does the **warm toggle** actually reach the GM (socketlib)?
- Anything that looks off.

**Not built yet** (don't report as bugs): the hot-meal cooking option, and real-inventory (**Ledger**) mode — those are M6-hot-meal / M8.
