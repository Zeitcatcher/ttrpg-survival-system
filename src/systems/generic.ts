import { MODULE_ID } from "../settings";
import type { DegreeOfSuccess, ResourceLot, SurvivalSystemAdapter } from "./adapter";

// Minimal system-neutral fallback adapter. Provides sane defaults so the bridge runs in any
// system; condition application is a no-op for now (real ActiveEffects land later). The pf2e
// adapter (M3) supersedes this for the pf2e system with native conditions + Con-mod grace.
export class GenericAdapter implements SurvivalSystemAdapter {
  readonly systemId = "generic";

  getResourceLots(): ResourceLot[] {
    return [];
  }
  getAvailable(): number {
    return 0;
  }
  async consume(): Promise<number> {
    return 0;
  }
  async grant(): Promise<void> {
    /* no-op in Abstract mode */
  }

  getCreatureRation(): { food: number; water: number } {
    return { food: 1, water: 1 };
  }
  getGraceDays(): number {
    return 1;
  }
  getSizeMult(actor: any): number {
    const size = actor?.system?.traits?.size?.value;
    if (size === "grg" || size === "gargantuan") return 8;
    if (size === "huge") return 4;
    if (size === "lg" || size === "large") return 2;
    return 1;
  }
  isMount(actor: any): boolean {
    return !!actor?.getFlag?.(MODULE_ID, "isMount");
  }
  needsConsumption(actor: any): boolean {
    const hp = actor?.system?.attributes?.hp?.value;
    return hp === undefined || hp > 0;
  }

  async reconcileConsequences(): Promise<void> {
    /* M3: apply module ActiveEffects keyed by track. */
  }

  isWarmSourceEquipped(): boolean {
    return false;
  }
  async rollForage(): Promise<DegreeOfSuccess | null> {
    return null;
  }
}
