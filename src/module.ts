import { openGmPanel, refreshGmPanel, setPanelAdapter } from "./apps/GmControlPanel";
import { openPartyHud, refreshPartyHud, setHudAdapter } from "./apps/PartyHud";
import { registerSheetInjection } from "./apps/sheet-injection";
import { postUpkeepCard } from "./apps/upkeepCard";
import { computeTick, DEFAULT_TICK_OPTIONS } from "./core";
import { registerSocket } from "./net/socket";
import { MODULE_ID, registerSettings } from "./settings";
import type { SurvivalSystemAdapter } from "./systems/adapter";
import { resolveActiveAdapter } from "./systems/registry";
import { addSelectedTokens, readHeadline, readModel, runTickViaFoundry } from "./state/bridge";

// Foundry entry point. Wiring only — survival logic lives in the system-neutral core (src/core)
// and the adapter seam (src/systems). The registry document, UI surfaces, and Rest trigger land
// across the remaining milestones.

const SECS_PER_DAY = 86400;
let activeAdapter: SurvivalSystemAdapter | undefined;

function isPrimaryGM(): boolean {
  return game.users?.activeGM?.isSelf === true;
}

// Left-toolbar buttons under Token Controls: everyone gets the party HUD, the GM also gets the
// panel. v13/v14 shape (controls is a Record; a tool needs name/title/icon/order/button/visible/
// onChange). Registered at top level so it's present before the controls first render.
Hooks.on("getSceneControlButtons", (controls: any) => {
  const tokens =
    controls?.tokens ?? (Array.isArray(controls) ? controls.find((c: any) => c.name === "tokens") : undefined);
  if (!tokens?.tools) return;
  const add = (tool: any) => {
    if (Array.isArray(tokens.tools)) tokens.tools.push(tool);
    else tokens.tools[tool.name] = tool;
  };
  add({
    name: `${MODULE_ID}-hud`,
    title: "SURVIVAL.Hud.Title",
    icon: "fa-solid fa-heart-pulse",
    order: 90,
    button: true,
    visible: true,
    onChange: () => openPartyHud(),
  });
  if (game.user?.isGM) {
    add({
      name: MODULE_ID,
      title: "SURVIVAL.Panel.Title",
      icon: "fa-solid fa-campground",
      order: 91,
      button: true,
      visible: true,
      onChange: () => openGmPanel(),
    });
  }
});

Hooks.once("init", () => {
  registerSettings();
  console.log(`${MODULE_ID} | init — settings registered`);
});

Hooks.once("ready", () => {
  activeAdapter = resolveActiveAdapter();
  setPanelAdapter(activeAdapter);
  setHudAdapter(activeAdapter);
  registerSheetInjection();

  // Ledger mode: seed the day-unit supply items once (GM only, if missing).
  if (game.user?.isGM && game.settings.get(MODULE_ID, "supplyDetail") === "ledger" && activeAdapter.seedSupplies) {
    activeAdapter.seedSupplies().catch((e: unknown) => console.warn(`${MODULE_ID} | seed supplies failed`, e));
  }

  const mod = game.modules.get(MODULE_ID);
  if (mod) {
    mod.api = {
      ping: () => "pong",
      computeTick,
      defaultTickOptions: DEFAULT_TICK_OPTIONS,
      adapter: activeAdapter,
      getHeadline: (group?: string) => readHeadline(activeAdapter!, group),
      readModel: () => readModel(activeAdapter!),
      runTick: (targetDay: number) => runTickViaFoundry(targetDay, activeAdapter!),
      addSelected: () => addSelectedTokens(),
      seedSupplies: () => activeAdapter?.seedSupplies?.() ?? Promise.resolve(),
      openPanel: () => openGmPanel(),
      openHud: () => openPartyHud(),
    };
  }

  // The toolbar buttons are registered at top level (below); if the controls already rendered
  // before this module was ready, force one re-render so they appear on first load.
  ui.controls?.render?.();

  // Keep open surfaces fresh when survival state changes (warmth flag, registry doc).
  const refresh = () => {
    refreshGmPanel();
    refreshPartyHud();
  };
  Hooks.on("updateActor", refresh);
  Hooks.on("updateJournalEntry", refresh);

  // One survival day per world-clock day-boundary crossing, primary GM only. Rest and an
  // "Advance Day/Week" control will call runTick directly in later milestones.
  Hooks.on("updateWorldTime", (worldTime: number, dt: number) => {
    if (!isPrimaryGM() || !activeAdapter) return;
    const prevDay = Math.floor((worldTime - dt) / SECS_PER_DAY);
    const newDay = Math.floor(worldTime / SECS_PER_DAY);
    if (newDay === prevDay) return;
    runTickViaFoundry(newDay, activeAdapter)
      .then((result) => postUpkeepCard(result))
      .catch((e: unknown) => console.error(`${MODULE_ID} | tick failed`, e));
  });

  ui.notifications?.info(game.i18n?.localize("SURVIVAL.Loaded") ?? "Survival module loaded.");
  console.log(`${MODULE_ID} | ready (system adapter: ${activeAdapter.systemId})`);
});

// socketlib must be registered in ITS ready hook, not core `init` (registering early throws).
Hooks.once("socketlib.ready", () => {
  registerSocket();
  console.log(`${MODULE_ID} | socketlib ready`);
});
