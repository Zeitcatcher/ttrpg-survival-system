# Changelog

Notable changes, newest first. Every version is also on the [Releases page](https://github.com/Zeitcatcher/ttrpg-survival-system/releases); to update inside Foundry, press Update on the module.

## 1.3.0

- Hot meals are on by default, and the Cook button works once per survival day. After you cook, it locks until the day advances, so a stray click can't burn extra firewood.
- The well-fed buff clears on its own. Its temporary Hit Points are now part of the effect, so removing the effect takes the HP with it, whether the next day begins, the party takes a Rest for the Night, or you delete it by hand. Before this, the HP lingered after the buff was gone.
- The built-in hot meal has its own icon.
- Cold weather burns more firewood: three bundles a night in the cold, six in extreme cold (was one and two).
- Pools & mounts: every row ends with the same two controls, transfer and remove. Removing a pack removes that creature; removing a base removes the base. The roster no longer carries its own remove button.

## 1.2.1

- Clearer separate and rejoin control in Pools and mounts. Each pool now always shows its state next to the name (with party or separated), and the button says what a click does: Leave when the pool is with the party, Rejoin once it's been left behind. The button stays bright and clickable even when the row is greyed out.

## 1.2.0

Added an optional Survival mode. By default nothing changes: consequences still cap at stage 3, and no one dies by accident. Turn it on and unchecked hunger, thirst, or cold keep climbing past stage 3 into worse conditions and, eventually, death.

- Three tiers to pick from: Off (today's behaviour), Harsh (extra debuff stages 4 and 5, but never fatal), and Survival (the full ladder, ending in death).
- Death is never automatic. At the fatal moment the GM gets a prompt for that character: confirm the death, knock them to dying (0 HP, allies can still save them), or spare them.
- New stages 4 and 5 pile on Drained and Doomed. Each track keeps its own flavour: hunger weakens, thirst sickens, cold stiffens.
- A pace setting (Slower, Balanced, Faster) controls how fast the fatal descent unfolds. Stages 1 to 3 are the same in every pace; only the climb to death changes speed.

## 1.1.3

Fixed the real cause of players never receiving the Create Water prompt: the manifest never declared `"socket": true`, so Foundry's server refused to relay the module's socket messages and socketlib refused to register it on any client, whatever the settings. One manifest line restores prompt delivery and the player "kept warm" toggle, which the same omission had silently broken. After updating, relaunch the world (Return to Setup, then Launch) so the server reads the new manifest. A browser reload is not enough.

## 1.1.2

Fixed Create Water not reaching players even with socketlib enabled. The socket is now wired on every client at world load and re-acquired when needed, so a missed startup hook no longer leaves the GM unable to send or the player unable to receive. The false "socketlib isn't active" warning is gone when it actually is active.

## 1.1.1

- The player's Create Water picker now shows one row per castable spell, with the spell's own icon and name, so you tick the ones to cast (three prepared Create Waters show three rows) instead of typing counts.
- Added diagnostics for the player prompt. It travels over socketlib, so if socketlib isn't active the GM is warned instead of it failing silently, and the browser console logs the flow on both sides.

## 1.1.0

Create Water rework.

- The owning player now gets a compact prompt to pick which water spells to cast and how many, so a caster can spend several slots when one casting isn't enough (Extreme Heat, for example). Previously the player saw nothing at all.
- The GM coordination dialog is compact, with Cast all, Cast one, or Skip per caster; a GM decision closes the player's prompt.
- Each casting makes the configured amount of water for that day (default 8), and multiple casts stack. Unused conjured water still evaporates at day's end.

## 1.0.0

First public release. A survival tracker for Foundry VTT: food, water, and firewood for a travelling party, with hunger, thirst, and cold as consequences.

Tracking

- One shared supply pool across party packs, a base or stockpile, and mounts, with a separation rule so the party can't draw from what it left behind.
- A days-of-supply header that shows the math: pooled total ÷ the party's daily need, per resource, and the pools it counted.
- Two supply modes: Ledger reads real actor inventory (Rations counted by their charges, waterskins, tagged items); Abstract is typed day-counts.

Consequences and climate

- Graded hunger, thirst, and cold as native Pathfinder 2e conditions, applied as the party starves and cleared as it recovers.
- Five climate bands: heat multiplies water use up to ×3 and brings thirst on sooner; cold burns firewood each night.
- Size-scaled consumption: Large ×2, Huge ×4, Gargantuan ×8.

Play

- A GM panel and a read-only player HUD, plus one consolidated daily upkeep card in chat, grouped by character.
- Advance a day, a week, or any number of days, or let the world clock drive it.
- Roster tools: add tokens, mark a mount or base, transfer supplies, remove creatures, reset statuses.
- Foraging, hot meals, and prompted Create Water (unused water evaporates at day's end).
- English and Russian.

Verified on Pathfinder 2e (Foundry v13+, tested on v14). The survival engine is system-agnostic; other system adapters aren't written yet.
