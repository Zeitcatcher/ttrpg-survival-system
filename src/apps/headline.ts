import type { GroupView } from "../state/readModel";

// Builds the "party supply" header view-model shared by the GM panel and the player HUD: the
// pooled days-of-supply per resource with its stored ÷ need math, the active climate's effects,
// and the "counted from" pool chips (present ones + separated ones flagged as left behind). Uses
// game.i18n, so it lives in the Foundry layer (not the pure read model).

const ICON: Record<string, string> = { food: "🍖", water: "💧", firewood: "🔥" };
const L = (key: string, data?: Record<string, unknown>): string =>
  data ? game.i18n.format(key, data) : game.i18n.localize(key);

export interface HeadlineCell {
  key: string;
  icon: string;
  label: string;
  needed: boolean;
  days: number;
  cls: "ok" | "warn" | "danger" | "muted";
  math: string;
}

export interface HeadlineView {
  partyCount: number;
  climateLine: string;
  cells: HeadlineCell[];
  sources: { label: string; separated: boolean; isStorage: boolean }[];
}

function urgency(needed: boolean, days: number): HeadlineCell["cls"] {
  if (!needed) return "muted";
  return days >= 3 ? "ok" : days >= 1 ? "warn" : "danger";
}

export function buildHeadlineView(g: GroupView): HeadlineView {
  const foodNeeded = g.need.food > 0;
  const waterNeeded = g.need.water > 0;
  const waterNote = g.waterMult > 1 ? ` (×${g.waterMult})` : "";

  const cells: HeadlineCell[] = [
    {
      key: "food", icon: ICON.food, label: L("SURVIVAL.Resource.food"), needed: foodNeeded,
      days: g.headline.food, cls: urgency(foodNeeded, g.headline.food),
      math: foodNeeded ? L("SURVIVAL.Headline.PerDay", { stored: g.stored.food, need: g.need.food }) : L("SURVIVAL.Headline.NotNeeded"),
    },
    {
      key: "water", icon: ICON.water, label: L("SURVIVAL.Resource.water"), needed: waterNeeded,
      days: g.headline.water, cls: urgency(waterNeeded, g.headline.water),
      math: waterNeeded ? L("SURVIVAL.Headline.PerDay", { stored: g.stored.water, need: g.need.water }) + waterNote : L("SURVIVAL.Headline.NotNeeded"),
    },
    {
      key: "firewood", icon: ICON.firewood, label: L("SURVIVAL.Resource.firewood"), needed: g.firewoodNeeded,
      days: g.headline.firewood, cls: urgency(g.firewoodNeeded, g.headline.firewood),
      math: g.firewoodNeeded ? L("SURVIVAL.Headline.PerNight", { stored: g.stored.firewood, need: g.need.firewood }) : L("SURVIVAL.Headline.NotNeeded"),
    },
  ];

  const effects: string[] = [];
  if (g.waterMult > 1) effects.push(L("SURVIVAL.Headline.EffWater", { mult: g.waterMult }));
  effects.push(g.firewoodNeeded ? L("SURVIVAL.Headline.EffFirewood", { n: g.need.firewood }) : L("SURVIVAL.Headline.EffNoFire"));
  if (g.climate === "extremeHeat") effects.push(L("SURVIVAL.Headline.EffHeatGrace"));
  if (g.coldActive) effects.push(L("SURVIVAL.Headline.EffCold"));
  const climateLine = `${L(`SURVIVAL.Band.${g.climate}`)} — ${effects.join(" · ")}`;

  return {
    partyCount: g.partyCount,
    climateLine,
    cells,
    sources: g.pools.map((p) => ({ label: p.label, separated: p.separated, isStorage: p.isStorage })),
  };
}
