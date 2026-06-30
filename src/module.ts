import { MODULE_ID, registerSettings } from "./settings";
import { computeTick, DEFAULT_TICK_OPTIONS } from "./core";

// Foundry entry point. Wiring only — all survival logic lives in the system-neutral core
// (src/core) and the adapter seam (src/systems). The registry document, UI surfaces, tick
// triggers, and the pf2e adapter land in later milestones.

Hooks.once("init", () => {
  registerSettings();
  console.log(`${MODULE_ID} | init — settings registered`);
});

Hooks.once("ready", () => {
  const mod = game.modules.get(MODULE_ID);
  if (mod) {
    // Minimal public API; expands as milestones land.
    mod.api = {
      ping: () => "pong",
      computeTick,
      defaultTickOptions: DEFAULT_TICK_OPTIONS,
    };
  }
  ui.notifications?.info("Survival module loaded.");
  console.log(`${MODULE_ID} | ready`);
});

// socketlib must be registered in ITS ready hook, not core `init` (registering early throws).
Hooks.once("socketlib.ready", () => {
  const socket = socketlib.registerModule(MODULE_ID);
  // executeAsGM handlers (runTick, setWithParty, editPool, setWarm…) register here in M4.
  void socket;
  console.log(`${MODULE_ID} | socketlib ready`);
});
