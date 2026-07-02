import { openGmPanel, refreshGmPanel, setPanelAdapter } from "./apps/GmControlPanel";
import { openPartyHud, refreshPartyHud, setHudAdapter } from "./apps/PartyHud";
import { registerSheetInjection } from "./apps/sheet-injection";
import { postUpkeepCard } from "./apps/upkeepCard";
import { computeTick, DEFAULT_TICK_OPTIONS } from "./core";
import { registerSocket } from "./net/socket";
import { MODULE_ID, registerSettings } from "./settings";
import type { SurvivalSystemAdapter } from "./systems/adapter";
import { resolveActiveAdapter } from "./systems/registry";
import {
  addSelectedTokens,
  diagnoseSurvival,
  migrateAbstractToLedger,
  readHeadline,
  readModel,
  runTickViaFoundry,
} from "./state/bridge";

// Foundry entry point. Wiring only — survival logic lives in the system-neutral core (src/core)
// and the adapter seam (src/systems). The registry document, UI surfaces, and Rest trigger land
// across the remaining milestones.

const SECS_PER_DAY = 86400;
let activeAdapter: SurvivalSystemAdapter | undefined;

function isPrimaryGM(): boolean {
  return game.users?.activeGM?.isSelf === true;
}

// Left-toolbar (Token Controls): exactly ONE survival button per user — the GM panel for a GM,
// the party HUD for a player. (Earlier builds added two buttons, so a GM saw a redundant pair.)
// v13/v14 shape: controls is a Record; a tool needs name/title/icon/order/button/visible/onChange.
// Registered at top level so it's present before the controls first render; guarded against the
// array-shaped path re-adding a duplicate on every re-render.
Hooks.on("getSceneControlButtons", (controls: any) => {
  const tokens =
    controls?.tokens ?? (Array.isArray(controls) ? controls.find((c: any) => c.name === "tokens") : undefined);
  if (!tokens?.tools) return;
  const tool = {
    name: MODULE_ID,
    title: "SURVIVAL.Panel.Title",
    icon: "fa-solid fa-campground",
    order: 90,
    button: true,
    visible: true,
    onChange: () => (game.user?.isGM ? openGmPanel() : openPartyHud()),
  };
  if (Array.isArray(tokens.tools)) {
    if (!tokens.tools.some((t: any) => t?.name === tool.name)) tokens.tools.push(tool);
  } else {
    tokens.tools[tool.name] = tool;
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

  // One-shot heal (0.4.1): a world that persisted Abstract but never typed any counts is
  // switched to Ledger, so inventory (rations, waterskins) counts as the default intends.
  if (game.user?.isGM && game.settings.get(MODULE_ID, "autoLedgerMigrated") !== true) {
    migrateAbstractToLedger()
      .then(async (flipped) => {
        if (flipped) ui.notifications?.info(game.i18n.localize("SURVIVAL.MigratedLedger"));
        await game.settings.set(MODULE_ID, "autoLedgerMigrated", true);
      })
      .catch((e: unknown) => console.warn(`${MODULE_ID} | ledger migration failed`, e));
  }

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
      diagnose: () => diagnoseSurvival(activeAdapter!),
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
