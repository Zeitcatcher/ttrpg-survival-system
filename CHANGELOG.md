# Changelog

Notable changes, newest first. Every version is also on the [Releases page](https://github.com/Zeitcatcher/ttrpg-survival-system/releases); to update inside Foundry, press Update on the module.

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
