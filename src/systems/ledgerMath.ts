// PURE inventory math for Ledger mode. A "lot" is one stack of a survival item, normalized to
// creature-days. Day-unit items (Water/Firewood/Ration "per day") have daysPerUnit = 1; a native
// pf2e "Rations (1 week)" stack has daysPerUnit = 7 with a partial-week counter (`daysUsed`).
// This handles the 7-ration decomposition without any Foundry dependency, so it's unit-tested.

export interface Lot {
  itemId: string;
  quantity: number; // number of item stacks (weeks, day-units, bundles)
  daysPerUnit: number; // 1 for day-units/bundles, 7 for week-rations
  daysUsed: number; // days already drawn from the current partially-used unit (0..daysPerUnit-1)
}

export function lotAvailable(l: Lot): number {
  return Math.max(0, l.quantity * l.daysPerUnit - l.daysUsed);
}

export function totalAvailable(lots: readonly Lot[]): number {
  return lots.reduce((sum, l) => sum + lotAvailable(l), 0);
}

export interface LotChange {
  itemId: string;
  newQuantity: number;
  newDaysUsed: number;
  delete: boolean;
}

export interface ConsumePlan {
  drawn: number;
  changes: LotChange[];
}

/** Draw `units` creature-days from `lots`, in order, decomposing week-rations as needed.
 *  Returns the amount actually drawn (≤ units) and the per-lot changes to apply. Pure. */
export function planConsume(lots: readonly Lot[], units: number): ConsumePlan {
  let remaining = Math.max(0, Math.floor(units));
  const changes: LotChange[] = [];
  for (const l of lots) {
    if (remaining <= 0) break;
    const avail = lotAvailable(l);
    if (avail <= 0) continue;
    const take = Math.min(avail, remaining);
    remaining -= take;

    const totalUsed = l.daysUsed + take;
    const wholeConsumed = Math.floor(totalUsed / l.daysPerUnit);
    const newQuantity = l.quantity - wholeConsumed;
    const newDaysUsed = totalUsed - wholeConsumed * l.daysPerUnit;
    changes.push({
      itemId: l.itemId,
      newQuantity: Math.max(0, newQuantity),
      newDaysUsed: newQuantity <= 0 ? 0 : newDaysUsed,
      delete: newQuantity <= 0,
    });
  }
  return { drawn: Math.floor(units) - remaining, changes };
}

/** Inverse of lotAvailable: represent `availableDays` as a whole-unit stack + partial counter —
 *  quantity = ceil(days / daysPerUnit), daysUsed = quantity*daysPerUnit − days (0..dpu−1). Used
 *  when GRANTING food as native week-Rations so the exact day-count is preserved. Pure. */
export function weekStackFor(availableDays: number, daysPerUnit: number): { quantity: number; daysUsed: number } {
  const avail = Math.max(0, Math.floor(availableDays));
  if (daysPerUnit <= 1) return { quantity: avail, daysUsed: 0 };
  const quantity = Math.ceil(avail / daysPerUnit);
  return { quantity, daysUsed: quantity * daysPerUnit - avail };
}
