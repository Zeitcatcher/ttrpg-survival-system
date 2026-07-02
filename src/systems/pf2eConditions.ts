import type { TrackKey } from "../core/types";

// PURE stage → native-condition planning for pf2e. Lives in src/systems (Pillar 1) but has no
// Foundry dependency, so it is fully unit-tested. The adapter applies the plan via the pf2e API.

export interface ConditionSpec {
  slug: string;
  value?: number;
}

// The full set of conditions demanded AT each stage (Fatigued carries through every active stage).
// Mirrors survival-mechanics §4. Stages 4–5 are only reached in the lethal modes (climbHarsh /
// climbToDeath); each track keeps its own flavour (hunger→enfeebled, thirst→sickened, cold→clumsy)
// and escalates Drained + Doomed toward the end. Stage 6 is DEATH — it carries no condition
// signature (the character dies), so `signature` clamps at 5.
const STAGE_MAP: Record<TrackKey, Record<number, ConditionSpec[]>> = {
  hunger: {
    1: [{ slug: "fatigued" }],
    2: [{ slug: "fatigued" }, { slug: "enfeebled", value: 1 }],
    3: [{ slug: "fatigued" }, { slug: "drained", value: 1 }],
    4: [{ slug: "fatigued" }, { slug: "enfeebled", value: 2 }, { slug: "drained", value: 2 }, { slug: "doomed", value: 1 }],
    5: [{ slug: "fatigued" }, { slug: "enfeebled", value: 2 }, { slug: "drained", value: 3 }, { slug: "doomed", value: 2 }],
  },
  thirst: {
    1: [{ slug: "fatigued" }],
    2: [{ slug: "fatigued" }, { slug: "sickened", value: 1 }],
    3: [{ slug: "fatigued" }, { slug: "drained", value: 1 }],
    4: [{ slug: "fatigued" }, { slug: "sickened", value: 2 }, { slug: "drained", value: 2 }, { slug: "doomed", value: 1 }],
    5: [{ slug: "fatigued" }, { slug: "sickened", value: 3 }, { slug: "drained", value: 3 }, { slug: "doomed", value: 2 }],
  },
  cold: {
    1: [{ slug: "fatigued" }],
    2: [{ slug: "fatigued" }, { slug: "clumsy", value: 1 }],
    3: [{ slug: "fatigued" }, { slug: "clumsy", value: 2 }, { slug: "drained", value: 1 }],
    4: [{ slug: "fatigued" }, { slug: "clumsy", value: 2 }, { slug: "drained", value: 2 }, { slug: "doomed", value: 1 }],
    5: [{ slug: "fatigued" }, { slug: "clumsy", value: 3 }, { slug: "drained", value: 3 }, { slug: "doomed", value: 2 }],
  },
};

function signature(track: TrackKey, stage: number): ConditionSpec[] {
  return stage >= 1 ? (STAGE_MAP[track][Math.min(stage, 5)] ?? []) : [];
}

/** Merge condition specs the PF2e-correct way: different condition TYPES coexist, but the SAME
 *  type from multiple tracks does NOT stack — the HIGHEST value wins (PF2e: "when you have the
 *  same condition from two sources, the higher value applies"). So hunger-Drained-1 + cold-Drained-1
 *  is Drained 1, not Drained 2; while Fatigued + Clumsy 2 + Drained 1 all coexist. */
function unionSpecs(specs: ConditionSpec[]): ConditionSpec[] {
  const bySlug = new Map<string, number | undefined>();
  for (const s of specs) {
    if (!bySlug.has(s.slug)) bySlug.set(s.slug, s.value);
    else if (s.value !== undefined) bySlug.set(s.slug, Math.max(bySlug.get(s.slug) ?? 0, s.value));
  }
  return [...bySlug.entries()].map(([slug, value]) => (value === undefined ? { slug } : { slug, value }));
}

/** The native conditions to assert on an actor for its current per-track stages: the union of
 *  every active track's full stage signature. Nothing is ever dropped to thin the list — a deeply
 *  deprived character genuinely carries each track's effects (up to three conditions at once at the
 *  worst stages). Recovery removes them only as the stages themselves step down. */
export function planConditions(stages: Record<TrackKey, number>): ConditionSpec[] {
  return unionSpecs([
    ...signature("hunger", stages.hunger),
    ...signature("thirst", stages.thirst),
    ...signature("cold", stages.cold),
  ]);
}
