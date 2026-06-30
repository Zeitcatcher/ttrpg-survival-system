import { forBand } from "../core/climate";
import type { Headline } from "../core/engine";
import type { CaravanState, ClimateBand, TrackKey } from "../core/types";

// PURE projection of the engine snapshot into a view-model the UI surfaces render. No Foundry,
// no ticking — just a read. Unit-tested; the GM panel and (later) the HUD consume this shape.

export interface PoolView {
  id: string;
  label: string;
  counts: { food: number; water: number; firewood: number };
  withParty: boolean;
  separated: boolean;
  isMount: boolean;
  isStorage: boolean;
}

export interface TrackView {
  stage: number;
  daysDeprived: number;
  grace: number;
  /** Localization key for the status name (e.g. "SURVIVAL.Status.thirst.2"), or null at stage 0. */
  statusKey: string | null;
  blockedHealing: boolean;
}

export interface RosterView {
  id: string;
  name: string;
  sizeMult: number;
  isMount: boolean;
  /** needs food+water = 0 (mephits, astral companions). */
  zeroNeeds: boolean;
  tracks: Record<TrackKey, TrackView>;
  /** True if no source could reach this consumer (mis-config badge). Filled by the engine later. */
  worstStage: number;
}

export interface GroupView {
  group: string;
  climate: ClimateBand;
  headline: Headline;
  waterMult: number;
  coldActive: boolean;
  firewoodNeeded: boolean;
  pools: PoolView[];
  roster: RosterView[];
}

const TRACKS: TrackKey[] = ["hunger", "thirst", "cold"];

export function projectGroup(state: CaravanState, group: string, headline: Headline): GroupView {
  const band = forBand(state.climate[group] ?? "temperate");

  const pools: PoolView[] = state.pools.map((p) => {
    const withParty = p.withParty[group] === true;
    return {
      id: p.id,
      label: p.label,
      counts: { ...p.counts },
      withParty,
      separated: !withParty,
      isMount: p.isMount,
      isStorage: p.isStorage,
    };
  });

  const roster: RosterView[] = state.consumers
    .filter((c) => c.group === group)
    .map((c) => {
      const st = state.actorState[c.id];
      const tracks = {} as Record<TrackKey, TrackView>;
      let worstStage = 0;
      for (const t of TRACKS) {
        const ts = st?.[t] ?? { daysDeprived: 0, stage: 0, blockedHealing: false };
        worstStage = Math.max(worstStage, ts.stage);
        tracks[t] = {
          stage: ts.stage,
          daysDeprived: ts.daysDeprived,
          grace: c.graceDays[t],
          statusKey: ts.stage >= 1 ? `SURVIVAL.Status.${t}.${Math.min(ts.stage, 3)}` : null,
          blockedHealing: ts.blockedHealing,
        };
      }
      return {
        id: c.id,
        name: c.name,
        sizeMult: c.sizeMult,
        isMount: c.isMount,
        zeroNeeds: c.ration.food === 0 && c.ration.water === 0,
        tracks,
        worstStage,
      };
    });

  return {
    group,
    climate: state.climate[group] ?? "temperate",
    headline,
    waterMult: band.waterMult,
    coldActive: band.cold,
    firewoodNeeded: band.bundles > 0,
    pools,
    roster,
  };
}

export function projectGroups(state: CaravanState, headlineByGroup: Record<string, Headline>): GroupView[] {
  return state.groups.map((g) =>
    projectGroup(state, g, headlineByGroup[g] ?? { food: 0, water: 0, firewood: 0 }),
  );
}
