import type { DegreeOfSuccess, ResourceKind, TrackKey } from "../core/types";
export type { DegreeOfSuccess } from "../core/types";

// The adapter seam. Core asks an adapter for exactly four irreducible, system-specific things:
// read resources, decrement resources, reconcile consequences, and classify/inspect actors.
// Everything else (timing, allocation, ladders, climate) is system-neutral core.
//
// NOTE: this is the ONLY place "pf2e" / game.system may appear (Pillar 1). The pf2e adapter
// implementing this interface lands in a later milestone; the interface fixes the contract now.

export interface ResourceLot {
  readonly kind: ResourceKind;
  readonly available: number; // creature-days (food/water) or bundles (firewood)
  readonly itemId: string; // opaque to core
  readonly label: string; // already-localized
}

export interface SurvivalSystemAdapter {
  readonly systemId: string;

  // INVENTORY (read) — normalized to creature-days / bundles
  getResourceLots(actor: any, kind: ResourceKind): ResourceLot[];
  getAvailable(actor: any, kind: ResourceKind): number;

  // INVENTORY (write) — handles 7-ration decomposition + per-system quantity path
  consume(actor: any, kind: ResourceKind, units: number): Promise<number>;
  grant(actor: any, kind: ResourceKind, units: number): Promise<void>;

  // CREATURE NEEDS / LIVENESS
  getCreatureRation(actor: any): { food: number; water: number };
  getGraceDays(actor: any, track: TrackKey): number;
  /** 1 (Medium/Small), 2 (Large), 4 (Huge) — derived from the system's size trait. */
  getSizeMult(actor: any): number;
  isMount(actor: any): boolean;
  needsConsumption(actor: any): boolean;

  // CONSEQUENCES — ONE idempotent reconcile over ALL tracks (union, combined-cap clamped)
  reconcileConsequences(actor: any, stages: Record<TrackKey, number>): Promise<void>;

  // WARMTH
  isWarmSourceEquipped(actor: any): boolean;

  // FORAGING (optional extra)
  rollForage?(actor: any, dc: number): Promise<DegreeOfSuccess | null>;

  // HOT MEAL (optional extra): grant a "well-fed" buff (temp HP + a 1-day marker effect).
  applyHotMeal?(actor: any): Promise<void>;

  // LEDGER MODE: seed the module's day-unit supply items into the world (GM convenience).
  seedSupplies?(): Promise<void>;
}
