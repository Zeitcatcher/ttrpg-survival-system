// PURE castability math over plain pf2e spellcasting-entry slot data. Knowing a spell is not
// enough — this answers "can it be cast RIGHT NOW": prepared = sitting in an unexpended slot;
// spontaneous/flexible = a slot of the spell's rank (or higher) remains; innate = uses left.
// No Foundry imports, so it is unit-tested; the adapter maps live entries into these shapes.

export interface PreparedSlot {
  id: string | null;
  expended?: boolean;
}

export interface SlotGroupData {
  prepared?: PreparedSlot[];
  value?: number; // remaining casts (spontaneous/flexible)
  max?: number;
}

export type CastingType = "prepared" | "spontaneous" | "flexible" | "innate" | string;

export interface CastAvailability {
  ok: boolean;
  /** The rank whose slot would be used (spontaneous may up-cast); undefined for innate/cantrip. */
  rankUsed?: number;
  /** Prepared casters: the index within the rank's prepared array. */
  slotId?: number;
}

const NOT_CASTABLE: CastAvailability = { ok: false };

/** Can `spellId` (of `rank`) be cast now? Cantrips are always castable. */
export function canCastNow(
  type: CastingType,
  slots: Record<string, SlotGroupData>,
  spellId: string,
  rank: number,
  opts: { isCantrip?: boolean; innateUsesLeft?: number } = {},
): CastAvailability {
  if (opts.isCantrip) return { ok: true };

  if (type === "prepared") {
    const group = slots[`slot${rank}`];
    const idx = (group?.prepared ?? []).findIndex((s) => s.id === spellId && s.expended !== true);
    return idx >= 0 ? { ok: true, rankUsed: rank, slotId: idx } : NOT_CASTABLE;
  }

  if (type === "spontaneous" || type === "flexible") {
    // A spontaneous caster may spend the spell's rank or heighten into a higher one.
    for (let r = rank; r <= 10; r++) {
      if ((slots[`slot${r}`]?.value ?? 0) > 0) return { ok: true, rankUsed: r };
    }
    return NOT_CASTABLE;
  }

  if (type === "innate") {
    return (opts.innateUsesLeft ?? 0) > 0 ? { ok: true } : NOT_CASTABLE;
  }

  return NOT_CASTABLE; // focus/charge/unknown — not supported for daily water
}

/** How many times this spell can be cast RIGHT NOW, so a player can spend several slots when one
 *  casting isn't enough (e.g. Extreme Heat). Prepared counts unexpended prepared copies across all
 *  ranks; spontaneous/flexible counts remaining slots at the spell's rank or higher; innate counts
 *  uses; a cantrip is effectively unlimited (returns the cap). Pure. */
export function countCastable(
  type: CastingType,
  slots: Record<string, SlotGroupData>,
  spellId: string,
  rank: number,
  opts: { isCantrip?: boolean; innateUsesLeft?: number; cantripCap?: number } = {},
): number {
  if (opts.isCantrip) return opts.cantripCap ?? 20;
  if (type === "prepared") {
    let n = 0;
    for (const key of Object.keys(slots)) {
      for (const s of slots[key]?.prepared ?? []) if (s.id === spellId && s.expended !== true) n++;
    }
    return n;
  }
  if (type === "spontaneous" || type === "flexible") {
    let n = 0;
    for (let r = rank; r <= 10; r++) n += Math.max(0, slots[`slot${r}`]?.value ?? 0);
    return n;
  }
  if (type === "innate") return Math.max(0, opts.innateUsesLeft ?? 0);
  return 0;
}
