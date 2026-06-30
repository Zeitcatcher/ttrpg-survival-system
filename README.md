# TTRPG Survival System

A **system-agnostic survival module for [Foundry VTT](https://foundryvtt.com/)** that automatically tracks survival resources for a party and applies graded consequences — kept lightweight and immersive, never a spreadsheet.

> **Status: Design phase.** Mechanics and architecture are being designed and reviewed before implementation begins. Nothing here is final.

## What it does (planned)

Tracks the survival resources a travelling party has to think about:

- **Water**, **food**, and **firewood** (firewood only when cooking needs fuel or a cold region needs warmth).
- Resources pooled across **player-character inventories**, a shared **storage / base stockpile**, and **mounts / pack animals** — each of which can be marked as *present with the party* or *separated* (e.g. left behind in another region), so the system never draws from supplies the party can't actually reach.
- Graded **hunger**, **thirst**, and **cold** consequences as readable, escalating character statuses.
- **Climate / temperature** awareness: hot regions drive thirst; cold regions require staying warm (satisfied simply — warm clothing or a fire).
- **Automated daily upkeep** with easy manual overrides through the module UI.

## Design goals

- **Secondary, not central.** Adds resource pressure and immersion without becoming the main game.
- **System-agnostic.** A system-neutral core with pluggable adapters. **First target: Pathfinder 2e (Remaster)**; D&D 5e and others to follow.
- **Localization-ready.** English by default, with proper i18n so a GM can select a locale in global settings.

## First use

The initial implementation targets **Pathfinder 2e** for the homebrew campaign **The Shards**.

## License

TBD.
