import type { SurvivalSystemAdapter } from "./adapter";
import { GenericAdapter } from "./generic";
import { Pf2eAdapter } from "./pf2e";

// The ONE place the active game system is read (Pillar 1). Core and orchestration call
// resolveActiveAdapter(); they never branch on game.system.id themselves.
export function adapterForSystem(systemId: string): SurvivalSystemAdapter {
  switch (systemId) {
    case "pf2e":
      return new Pf2eAdapter();
    // case "dnd5e": return new Dnd5eAdapter();  // future
    default:
      return new GenericAdapter();
  }
}

export function resolveActiveAdapter(): SurvivalSystemAdapter {
  return adapterForSystem(game.system?.id ?? "generic");
}
