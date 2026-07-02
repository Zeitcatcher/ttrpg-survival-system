# Changelog

Notable changes, newest first. Every version is also on the [Releases page](https://github.com/Zeitcatcher/ttrpg-survival-system/releases); to update inside Foundry, press Update on the module.

## 1.2.0

- Added an optional **Survival mode**. By default nothing changes — consequences still cap at stage 3, and no one dies by accident. Turn it on and unchecked hunger, thirst, or cold keep escalating past stage 3 into worse conditions and, eventually, death.
  - Three tiers: **Off** (today's behaviour), **Harsh** (extra debuff stages 4–5, but never fatal), and **Survival** (the full ladder, ending in death).
  - Death is never automatic: at the fatal moment the GM gets a prompt for that character — **Confirm death**, **Knock to Dying** (0 HP, allies can still save them), or **Spare**.
  - New stages 4–5 pile on Drained and Doomed (each track keeps its own flavour — hunger weakens, thirst sickens, cold stiffens), so a dying character genuinely can't cheat the end.
  - A **pace** setting — Slower / Balanced / Faster — controls how fast the fatal descent unfolds. Stages 1–3 are the same in every pace; only the climb to death speeds up or slows down.

## 1.1.3

- The actual fix for players never receiving the Create Water prompt: the manifest never declared `"socket": true`, so Foundry's server refused to relay the module's socket messages and socketlib refused to register it — on every client, no matter the settings. One manifest line fixes prompt delivery and the player "kept warm" toggle, which had been silently broken by the same cause. After updating, relaunch the world (Return to Setup → Launch) so the server reads the new manifest — a browser reload is not enough.

## 1.1.2

- Fixed Create Water not reaching players even with socketlib enabled. The socket is now wired on every client at world load and re-acquired when needed, so a missed startup hook no longer leaves the GM unable to send or the player unable to receive — and the false "socketlib isn't active" warning is gone when it actually is active.

## 1.1.1

- The player's Create Water picker now shows one row per castable spell — the spell's own icon and name — so you tick the ones to cast (three prepared Create Waters show three rows) instead of typing counts.
- Added diagnostics for the player prompt: the prompt travels over socketlib, so if socketlib isn't active the GM is now warned instead of it failing silently, and the browser console logs the flow on both sides.

## 1.1.0

Create Water rework.

- The owning player now gets a compact prompt to pick which water spell(s) to cast and how many — so a caster can spend several slots when one casting isn't enough (e.g. Extreme Heat). Previously the player saw nothing at all.
- The GM coordination dialog is compact, with Cast all / Cast one / Skip per caster; a GM decision closes the player's prompt.
- Each casting makes the configured amount of water for that day (default 8), and multiple casts stack. Unused conjured water still evaporates at day's end.

## 1.0.0

First public release. A survival tracker for Foundry VTT: food, water, and firewood for a travelling party, with hunger, thirst, and cold as consequences.

Tracking

- One shared supply pool across party packs, a base or stockpile, and mounts, with a separation rule so the party can't draw from what it left behind.
- A days-of-supply header that shows the math: pooled total ÷ the party's daily need, per resource, and the pools it counted.
- Two supply modes — Ledger reads real actor inventory (Rations counted by their charges, waterskins, tagged items); Abstract is typed day-counts.

Consequences and climate

- Graded hunger, thirst, and cold as native Pathfinder 2e conditions, applied as the party starves and cleared as it recovers.
- Five climate bands: heat multiplies water use up to ×3 and brings thirst on sooner; cold burns firewood each night.
- Size-scaled consumption — Large ×2, Huge ×4, Gargantuan ×8.

Play

- A GM panel and a read-only player HUD, plus one consolidated daily upkeep card in chat, grouped by character.
- Advance a day, a week, or any number of days, or let the world clock drive it.
- Roster tools: add tokens, mark a mount or base, transfer supplies, remove creatures, reset statuses.
- Foraging, hot meals, and prompted Create Water (unused water evaporates at day's end).
- English and Russian.

Verified on Pathfinder 2e (Foundry v13+, tested on v14). The survival engine is system-agnostic; other system adapters aren't written yet.
