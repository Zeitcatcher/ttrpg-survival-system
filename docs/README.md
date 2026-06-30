# Design docs

Design + build plan for the **TTRPG Survival System** Foundry VTT module.

| Doc | What | Status |
|---|---|---|
| [survival-mechanics.md](survival-mechanics.md) | Step 1 — game design (resources, separation rule, hunger/thirst/cold ladders, climate, mounts, extras) | **Locked** (decisions in §10) |
| [architecture.md](architecture.md) | Step 2 — technical architecture (Part A) + implementation-level detail (Part B) | **Finalized** |
| [implementation-plan.md](implementation-plan.md) | Phased build plan (M0–M9), testing strategy, "first three PRs" | Ready |
| [design.html](design.html) | All three docs above, rendered into one offline page with a sticky table of contents | Generated |
| [mockups/survival-ui-mockups.html](mockups/survival-ui-mockups.html) | Visual mockups — GM Control Panel, Players Party HUD, Daily Upkeep card | Generated |

## How this was produced

Multi-agent design + adversarial review: PF2e/Foundry prior-art research, three competing mechanics designs synthesized into one, a full architecture, detailed UI specs, and verification passes. Critique fixes are folded into the docs.

## Status

Design **step 1 is locked**; architecture **step 2 is finalized**. Next: build per [implementation-plan.md](implementation-plan.md), starting with the **M0 scaffold** and the **M2 engine heart** (Abstract supply mode first; separation rule, the Chiga-Biga ×4 mount consumer, and week/N-day advance are all proven headless in M2).

Targets **Pathfinder 2e (Remaster)** first (campaign *The Shards*) on **Foundry v13+/v14**; system-agnostic by design; English default, `en` + `ru` shipped together.
