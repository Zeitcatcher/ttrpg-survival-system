// The dials, as a declarative table (pure data — unit-tested) plus a Foundry registration pass.
// Defaults are the locked decisions for The Shards.

export const MODULE_ID = "ttrpg-survival-system";

export type SettingScope = "world" | "client";
export type SettingType = "String" | "Number" | "Boolean" | "Object";

export interface SettingDef {
  key: string;
  scope: SettingScope;
  type: SettingType;
  default: unknown;
  config: boolean;
  choices?: Record<string, string>;
}

// Locked decisions (2026-06-30): Abstract supply mode at launch; track food+water+firewood;
// upkeep only when wrong; communal-first; manual climate; cap at stage 3; single-party;
// foraging off; week/N-day advance with a 14-day catch-up cap; ship en+ru.
export const SETTINGS: readonly SettingDef[] = [
  // Ledger by default since 0.4.0 — GMs expect items (rations, waterskins) to count automatically.
  { key: "supplyDetail", scope: "world", type: "String", default: "ledger", config: true,
    choices: { abstract: "Abstract (day counts)", ledger: "Ledger (real inventory)" } },
  { key: "trackedNeeds", scope: "world", type: "Object", default: { food: true, water: true, firewood: true }, config: false },
  { key: "upkeepPrompt", scope: "world", type: "String", default: "onlyWhenWrong", config: true,
    choices: { always: "Always show", onlyWhenWrong: "Only when something's wrong" } },
  { key: "sourceMode", scope: "world", type: "String", default: "communalFirst", config: true,
    choices: { communalFirst: "Communal first", personalFirst: "Personal first" } },
  { key: "climateModel", scope: "world", type: "String", default: "manual", config: true,
    choices: { off: "Off", manual: "Manual band", auto: "Read weather module (later)" } },
  { key: "lethalDeprivation", scope: "world", type: "String", default: "capStage3", config: true,
    choices: { capStage3: "Cap at stage 3", climbToDeath: "Climb to death" } },
  { key: "splitPartyMode", scope: "world", type: "String", default: "single", config: true,
    choices: { single: "Single party", named: "Named groups" } },
  { key: "foraging", scope: "world", type: "Boolean", default: false, config: true },
  { key: "forageDC", scope: "world", type: "Number", default: 15, config: true },
  { key: "nextWaterDays", scope: "world", type: "Number", default: 0, config: true },
  { key: "hotMeal", scope: "world", type: "Boolean", default: false, config: true },
  { key: "hotMealEffectUuid", scope: "world", type: "String", default: "", config: true },
  { key: "maxCatchUpDays", scope: "world", type: "Number", default: 14, config: true },
  { key: "mountDefaultApplyConsequences", scope: "world", type: "Boolean", default: false, config: true },
  { key: "hudDensity", scope: "client", type: "String", default: "full", config: true,
    choices: { full: "Full", compact: "Compact" } },
  // Internal bookkeeping (not shown in the config UI).
  { key: "caravanDocUuid", scope: "world", type: "String", default: "", config: false },
  { key: "lastTickDay", scope: "world", type: "Number", default: 0, config: false },
  { key: "dataVersion", scope: "world", type: "Number", default: 1, config: false },
  { key: "autoLedgerMigrated", scope: "world", type: "Boolean", default: false, config: false },
];

/** Register every dial with Foundry. Called from the `init` hook. */
export function registerSettings(): void {
  const typeCtor = { String, Number, Boolean, Object } as const;
  for (const s of SETTINGS) {
    game.settings.register(MODULE_ID, s.key, {
      scope: s.scope,
      config: s.config,
      type: typeCtor[s.type],
      default: s.default,
      ...(s.choices ? { choices: s.choices } : {}),
      name: `SURVIVAL.Settings.${s.key}.name`,
      hint: `SURVIVAL.Settings.${s.key}.hint`,
    });
  }
}
