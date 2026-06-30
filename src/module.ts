import { MODULE_ID, registerSettings } from "./settings";
import { computeTick, DEFAULT_TICK_OPTIONS } from "./core";
import { GenericAdapter } from "./systems/generic";
import { readHeadline, runTickViaFoundry } from "./state/bridge";

// Foundry entry point. Wiring only — all survival logic lives in the system-neutral core
// (src/core) and the adapter seam (src/systems). The registry document, UI surfaces, tick
// triggers, and the pf2e adapter land in later milestones.

Hooks.once("init", () => {
  registerSettings();
  console.log(`${MODULE_ID} | init — settings registered`);
});

Hooks.once("ready", () => {
  // Resolve the active adapter (M3 adds a pf2e adapter keyed by game.system.id; generic for now).
  const adapter = new GenericAdapter();

  const mod = game.modules.get(MODULE_ID);
  if (mod) {
    // Public API; expands as milestones land. runTick/getHeadline persist via the Caravan registry.
    mod.api = {
      ping: () => "pong",
      computeTick,
      defaultTickOptions: DEFAULT_TICK_OPTIONS,
      adapter,
      getHeadline: (group?: string) => readHeadline(adapter, group),
      runTick: (targetDay: number) => runTickViaFoundry(targetDay, adapter),
    };
  }
  ui.notifications?.info(game.i18n?.localize("SURVIVAL.Loaded") ?? "Survival module loaded.");
  console.log(`${MODULE_ID} | ready`);
});

// socketlib must be registered in ITS ready hook, not core `init` (registering early throws).
Hooks.once("socketlib.ready", () => {
  const socket = socketlib.registerModule(MODULE_ID);
  // executeAsGM handlers (runTick, setWithParty, editPool, setWarm…) register here in M4.
  void socket;
  console.log(`${MODULE_ID} | socketlib ready`);
});
