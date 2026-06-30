# Design docs

Design for the **TTRPG Survival System** Foundry VTT module. We design in two steps; **step 1 must be approved before step 2 is finalized.**

| Doc | Step | Status |
|---|---|---|
| [survival-mechanics.md](survival-mechanics.md) | **1 — game design** (resources, separation rule, hunger/thirst/cold ladders, climate/warmth, automation, mounts, extras) | **Draft for review** — start here |
| [architecture.md](architecture.md) | 2 — technical architecture (system-agnostic core + adapters, data model, daily tick, UI, i18n) | Preliminary — direction only, finalized after step 1 locks |

## How this design was produced

A multi-agent analysis: research into PF2e Remaster's existing survival/environment rules, existing Foundry survival modules, and system-agnostic module patterns; three competing mechanics designs judged and synthesized; a full architecture; and three adversarial critiques (table-feel, edge-cases, technical soundness). The critiques' fixes are already folded into both docs.

## To move forward

1. Read [survival-mechanics.md](survival-mechanics.md), especially **§10 — Open decisions**.
2. React / refine — change anything; this is a draft.
3. Approve step 1 → we finalize [architecture.md](architecture.md) and begin implementation.

Targets **Pathfinder 2e (Remaster)** first (campaign *The Shards*); system-agnostic by design. English default, localization-ready (`en` + `ru`).
