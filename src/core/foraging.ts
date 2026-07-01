import type { DegreeOfSuccess } from "./types";

// PURE foraging logic (Subsist / Survival). The Foundry adapter rolls the check and passes the
// total + raw d20 here; the four-degree outcome and its food yield are computed here and tested.

const DEGREES: DegreeOfSuccess[] = ["critFail", "fail", "success", "critSuccess"];

/** PF2e four-degree rule: ≥DC+10 crit success, ≥DC success, ≤DC−10 crit failure, else failure.
 *  A natural 20 shifts one degree up, a natural 1 one degree down. */
export function computeDegree(total: number, d20: number, dc: number): DegreeOfSuccess {
  let deg = total >= dc + 10 ? 3 : total >= dc ? 2 : total <= dc - 10 ? 0 : 1;
  if (d20 === 20) deg = Math.min(3, deg + 1);
  else if (d20 === 1) deg = Math.max(0, deg - 1);
  return DEGREES[deg];
}

export interface ForageResult {
  /** Creature-days of food gathered. */
  food: number;
  /** The forager is fatigued (failure/crit-failure). */
  fatigued: boolean;
}

/** Yield of a Subsist attempt: crit feeds 2, success feeds 1, failure feeds none (+fatigued). */
export function forageYield(degree: DegreeOfSuccess): ForageResult {
  switch (degree) {
    case "critSuccess":
      return { food: 2, fatigued: false };
    case "success":
      return { food: 1, fatigued: false };
    case "fail":
      return { food: 0, fatigued: true };
    case "critFail":
      return { food: 0, fatigued: true };
  }
}
