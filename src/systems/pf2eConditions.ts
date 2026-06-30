import type { TrackKey } from "../core/types";

// PURE stage → native-condition planning for pf2e. Lives in src/systems (Pillar 1) but has no
// Foundry dependency, so it is fully unit-tested. The adapter applies the plan via the pf2e API.

export interface ConditionSpec {
  slug: string;
  value?: number;
}

export type CombinedCap = "fatiguedPlusOne" | "uncapped";

// The full set of conditions demanded AT each stage (Fatigued carries through every active stage).
// Mirrors survival-mechanics §4. Stage 4 is only reached when the lethal dial = climbToDeath.
const STAGE_MAP: Record<TrackKey, Record<number, ConditionSpec[]>> = {
  hunger: {
    1: [{ slug: "fatigued" }],
    2: [{ slug: "fatigued" }, { slug: "enfeebled", value: 1 }],
    3: [{ slug: "fatigued" }, { slug: "drained", value: 1 }],
    4: [{ slug: "fatigued" }, { slug: "drained", value: 2 }, { slug: "doomed", value: 1 }],
  },
  thirst: {
    1: [{ slug: "fatigued" }],
    2: [{ slug: "fatigued" }, { slug: "sickened", value: 1 }],
    3: [{ slug: "fatigued" }, { slug: "drained", value: 1 }],
    4: [{ slug: "fatigued" }, { slug: "drained", value: 2 }, { slug: "doomed", value: 1 }],
  },
  cold: {
    1: [{ slug: "fatigued" }],
    2: [{ slug: "fatigued" }, { slug: "clumsy", value: 1 }],
    3: [{ slug: "fatigued" }, { slug: "clumsy", value: 2 }, { slug: "drained", value: 1 }],
    4: [{ slug: "fatigued" }, { slug: "drained", value: 2 }, { slug: "doomed", value: 1 }],
  },
};

// Higher = nastier; used to pick the single "one other" condition under the combined cap.
const SEVERITY: Record<string, number> = {
  doomed: 6, drained: 5, enfeebled: 4, sickened: 3, clumsy: 2, fatigued: 1,
};

function signature(track: TrackKey, stage: number): ConditionSpec[] {
  return stage >= 1 ? (STAGE_MAP[track][Math.min(stage, 4)] ?? []) : [];
}

/** Merge specs, taking the MAX value for a repeated slug (same-type conditions don't stack). */
function unionSpecs(specs: ConditionSpec[]): ConditionSpec[] {
  const bySlug = new Map<string, number | undefined>();
  for (const s of specs) {
    if (!bySlug.has(s.slug)) bySlug.set(s.slug, s.value);
    else if (s.value !== undefined) bySlug.set(s.slug, Math.max(bySlug.get(s.slug) ?? 0, s.value));
  }
  return [...bySlug.entries()].map(([slug, value]) => (value === undefined ? { slug } : { slug, value }));
}

/** Resolve the per-track stages to the set of native conditions to assert on the actor.
 *  - `uncapped`: the union of every active track's signature.
 *  - `fatiguedPlusOne`: Fatigued (if any track is active) + the single most-severe other condition,
 *    so a deprived character never carries more than two module debuffs at once. */
export function planConditions(stages: Record<TrackKey, number>, cap: CombinedCap): ConditionSpec[] {
  const union = unionSpecs([
    ...signature("hunger", stages.hunger),
    ...signature("thirst", stages.thirst),
    ...signature("cold", stages.cold),
  ]);
  if (cap === "uncapped") return union;

  const fatigued = union.find((s) => s.slug === "fatigued");
  const others = union
    .filter((s) => s.slug !== "fatigued")
    .sort((a, b) => (SEVERITY[b.slug] ?? 0) - (SEVERITY[a.slug] ?? 0) || (b.value ?? 0) - (a.value ?? 0));

  const out: ConditionSpec[] = [];
  if (fatigued) out.push(fatigued);
  if (others[0]) out.push(others[0]);
  return out;
}
