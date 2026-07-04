# Screenshots — shot list

The README front page references the twelve images below. Capture them and drop them in
`docs/images/` with these exact names; until then GitHub shows broken-image placeholders.
New for 1.4.0: `recovery.png` and `hot-meal.png`. The hero `panel.png` and `roster.png` are
worth re-taking too, since the UI gained the Leave/Rejoin controls, a remove (✕) on every pool
row, and the mid-day recovery strip since they were first shot.

General tips
- Use the dark Foundry theme (the module UI is dark) on a Pathfinder 2e world.
- Set up a small demo party first (5–7 tokens, one Huge/Gargantuan mount as the base) so the
  numbers look real. A desert / Extreme heat climate makes water pressure obvious.
- Crop tightly to the window — no need for the whole Foundry canvas. PNG, roughly 700–1000 px wide.
- Web-optimize (a PNG squisher) so the repo stays light.

| File | What to capture |
|---|---|
| `docs/images/panel.png` | **Hero. Re-take for 1.4.0.** The whole GM panel with the current UI: the "Party supply — pooled" header, the Pools & mounts rows (each with its state chip, a Leave/Rejoin button, and a remove ✕), and the roster with the recovery strip. Pick a low-water day so there's some tension. |
| `docs/images/roster.png` | **Re-take.** The panel's roster: a few characters with the party-member / base chips under their names, the mount shown as `Gargantuan ×8`, and the whole-party Fed / Watered / Warmed strip above the table. |
| `docs/images/header.png` | Close-up of the **supply header** in Extreme heat: the days-of-supply cells with their `stored ÷ need/day` math, the climate-effects line, and the **"Counted from:"** chips — ideally with a base **struck through as "left behind"** so the separation cliff is visible. |
| `docs/images/upkeep-card.png` | The **daily upkeep chat card** after advancing into a shortfall: grouped by character, each with what they went without and their hunger/thirst/cold. |
| `docs/images/hud.png` | The **player HUD** (log in as a player, or show it via `api.openHud()`): the pooled header plus each member's worst status, and the "kept warm?" toggle in a cold climate. |
| `docs/images/item-resource.png` | An item sheet (e.g. Rations or a waterskin) with the **"Survival resource"** dropdown at the bottom of the sheet. |
| `docs/images/transfer.png` | The **Transfer supplies** dialog (the ⇄ button on a pool): target pool, resource, amount. |
| `docs/images/create-water.png` | The **Create Water** prompt — the GM coordination dialog listing eligible casters, or the player's "Conjure water?" dialog. |
| `docs/images/survival-mode-and-pace-settings.png` | The **module-settings** rows for **Survival mode** (Off / Harsh / Survival) and **Survival mode pace** (Slower / Balanced / Faster), so the three tiers and the pace are visible. |
| `docs/images/survival-mode.png` | The **death prompt** with Survival mode on — the "at death's door" dialog for a character (Confirm death / Knock to Dying / Spare). Turn `Survival mode` on, advance a stranded party until someone hits the fatal stage. Bonus: frame it with the roster behind, showing a red "Dying of thirst" status. |
| `docs/images/recovery.png` | **New.** The roster with the mid-day recovery controls: a character or two carrying hunger/thirst/cold, the small green step-down (▾) on those tracks, and the whole-party **🍖 Fed / 💧 Watered / 🔥 Warmed** strip above the table. Deprive a small party a couple of days first so the stages show. |
| `docs/images/hot-meal.png` | **New.** A cooked hot meal: the **Cook hot meal** button in the Pools & mounts header, and the **well-fed effect** (its custom icon) on a token or character sheet with the temporary Hit Points it grants. Enable Hot meal, have firewood on hand, and click Cook. |
