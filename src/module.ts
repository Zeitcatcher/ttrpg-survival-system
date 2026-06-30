import { computeTick, DEFAULT_TICK_OPTIONS } from "./core";
import { MODULE_ID, registerSettings } from "./settings";
import type { SurvivalSystemAdapter } from "./systems/adapter";
import { resolveActiveAdapter } from "./systems/registry";
import { readHeadline, runTickViaFoundry } from "./state/bridge";

// Foundry entry point. Wiring only — survival logic lives in the system-neutral core (src/core)
// and the adapter seam (src/systems). The registry document, UI surfaces, and Rest trigger land
// across the remaining milestones.

const SECS_PER_DAY = 86400;
let activeAdapter: SurvivalSystemAdapter | undefined;

function isPrimaryGM(): boolean {
  return game.users?.activeGM?.isSelf === true;
}

Hooks.once("init", () => {
  registerSettings();
  console.log(`${MODULE_ID} | init — settings registered`);
});

Hooks.once("ready", () => {
  activeAdapter = resolveActiveAdapter();

  const mod = game.modules.get(MODULE_ID);
  if (mod) {
    mod.api = {
      ping: () => "pong",
      computeTick,
      defaultTickOptions: DEFAULT_TICK_OPTIONS,
      adapter: activeAdapter,
      getHeadline: (group?: string) => readHeadline(activeAdapter!, group),
      runTick: (targetDay: number) => runTickViaFoundry(targetDay, activeAdapter!),
    };
  }

  // One survival day per world-clock day-boundary crossing, primary GM only. Rest and an
  // "Advance Day/Week" control will call runTick directly in later milestones.
  Hooks.on("updateWorldTime", (worldTime: number, dt: number) => {
    if (!isPrimaryGM() || !activeAdapter) return;
    const prevDay = Math.floor((worldTime - dt) / SECS_PER_DAY);
    const newDay = Math.floor(worldTime / SECS_PER_DAY);
    if (newDay === prevDay) return;
    runTickViaFoundry(newDay, activeAdapter).catch((e: unknown) =>
      console.error(`${MODULE_ID} | tick failed`, e),
    );
  });

  ui.notifications?.info(game.i18n?.localize("SURVIVAL.Loaded") ?? "Survival module loaded.");
  console.log(`${MODULE_ID} | ready (system adapter: ${activeAdapter.systemId})`);
});

// socketlib must be registered in ITS ready hook, not core `init` (registering early throws).
Hooks.once("socketlib.ready", () => {
  const socket = socketlib.registerModule(MODULE_ID);
  // executeAsGM handlers (runTick, setWithParty, editPool, setWarm…) register here in M4.
  void socket;
  console.log(`${MODULE_ID} | socketlib ready`);
});
