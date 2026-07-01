import { openGmPanel, refreshGmPanel, setPanelAdapter } from "./apps/GmControlPanel";
import { openPartyHud, refreshPartyHud, setHudAdapter } from "./apps/PartyHud";
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

Hooks.once("init", () => {
  registerSettings();
  console.log(`${MODULE_ID} | init — settings registered`);
});

Hooks.once("ready", () => {
  activeAdapter = resolveActiveAdapter();
  setPanelAdapter(activeAdapter);
  setHudAdapter(activeAdapter);

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
      openPanel: () => openGmPanel(),
      openHud: () => openPartyHud(),
    };
  }

  // Toolbar buttons: everyone gets the party HUD; the GM also gets the control panel.
  // Defensive across v12 (array of controls) and v13 (object of controls).
  Hooks.on("getSceneControlButtons", (controls: any) => {
    const addTool = (tool: any) => {
      const tokens = Array.isArray(controls)
        ? controls.find((c: any) => c.name === "token" || c.name === "tokens")
        : (controls.tokens ?? controls.token);
      if (!tokens) return;
      if (Array.isArray(tokens.tools)) tokens.tools.push(tool);
      else if (tokens.tools) tokens.tools[tool.name] = tool;
    };
    try {
      addTool({
        name: `${MODULE_ID}-hud`,
        title: "SURVIVAL.Hud.Title",
        icon: "fa-solid fa-heart-pulse",
        button: true,
        onClick: () => openPartyHud(),
        onChange: () => openPartyHud(),
      });
      if (game.user?.isGM) {
        addTool({
          name: MODULE_ID,
          title: "SURVIVAL.Panel.Title",
          icon: "fa-solid fa-campground",
          button: true,
          onClick: () => openGmPanel(),
          onChange: () => openGmPanel(),
        });
      }
    } catch (e) {
      console.warn(`${MODULE_ID} | could not add scene controls`, e);
    }
  });

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
