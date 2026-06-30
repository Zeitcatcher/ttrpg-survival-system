import type { ClimateBand } from "../core/types";
import { MODULE_ID } from "../settings";
import {
  addSelectedTokens,
  advanceDays,
  applyDelvingPreset,
  editPool,
  readModel,
  setClimate,
  setWithParty,
} from "../state/bridge";
import type { SurvivalSystemAdapter } from "../systems/adapter";

const BANDS: ClimateBand[] = ["temperate", "hot", "extremeHeat", "cold", "extremeCold"];

// The active adapter, injected on ready. The panel is GM-only, so its mutations run directly on
// the GM client (player-driven writes go through socketlib later, in M5).
let panelAdapter: SurvivalSystemAdapter | undefined;
export function setPanelAdapter(a: SurvivalSystemAdapter): void {
  panelAdapter = a;
}

// ---- action handlers (Foundry binds `this` to the application instance) ----
async function onAdvance(this: any, _e: Event, target: HTMLElement): Promise<void> {
  const days = Number(target.dataset.days ?? "1");
  if (panelAdapter) await advanceDays(days, panelAdapter);
  this.render();
}
async function onToggleParty(this: any, _e: Event, target: HTMLElement): Promise<void> {
  await setWithParty(target.dataset.pool!, "Main", target.dataset.with === "true");
  this.render();
}
async function onDelving(this: any): Promise<void> {
  await applyDelvingPreset("Main", true);
  this.render();
}
async function onSetClimate(this: any, _e: Event, target: HTMLElement): Promise<void> {
  await setClimate("Main", target.dataset.band as ClimateBand);
  this.render();
}
async function onEditPool(this: any, _e: Event, target: HTMLElement): Promise<void> {
  const value = await promptNumber(Number(target.dataset.current ?? "0"));
  if (value === null) return;
  await editPool(target.dataset.pool!, target.dataset.kind as "food" | "water" | "firewood", value);
  this.render();
}
async function onAddSelected(this: any): Promise<void> {
  const n = await addSelectedTokens();
  ui.notifications?.info(game.i18n.format("SURVIVAL.Panel.Added", { n }));
  this.render();
}

async function promptNumber(current: number): Promise<number | null> {
  try {
    const value = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize("SURVIVAL.Panel.EditPool") },
      content: `<input type="number" name="value" value="${current}" step="1" min="0" autofocus style="width:100%">`,
      ok: {
        label: game.i18n.localize("SURVIVAL.Panel.Set"),
        callback: (_ev: Event, button: any) => Number(button.form.elements.value.value),
      },
    });
    return typeof value === "number" && !Number.isNaN(value) ? value : null;
  } catch {
    return null; // dialog dismissed
  }
}

function fmtClock(t: { stage: number; daysDeprived: number; grace: number; statusKey: string | null }) {
  return {
    label: t.statusKey ? game.i18n.localize(t.statusKey) : "—",
    clock: `${t.daysDeprived}/${t.grace}`,
    cls: t.stage >= 3 ? "danger" : t.stage >= 1 ? "warn" : "",
  };
}

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class GmControlPanel extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "shards-survival-gm",
    classes: ["shards-survival", "ss-gm"],
    tag: "div",
    window: { title: "SURVIVAL.Panel.Title", icon: "fa-solid fa-campground", resizable: true },
    position: { width: 580 },
    actions: {
      advance: onAdvance,
      toggleParty: onToggleParty,
      delving: onDelving,
      setClimate: onSetClimate,
      editPool: onEditPool,
      addSelected: onAddSelected,
    },
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/gm-panel.hbs` },
  };

  async _prepareContext(): Promise<any> {
    const groups = panelAdapter ? await readModel(panelAdapter) : [];
    const g = groups[0];
    if (!g) return { hasData: false };

    return {
      hasData: true,
      climate: g.climate,
      waterMult: g.waterMult,
      firewoodNeeded: g.firewoodNeeded,
      headline: g.headline,
      bands: BANDS.map((b) => ({
        band: b,
        active: b === g.climate,
        label: game.i18n.localize(`SURVIVAL.Band.${b}`),
      })),
      pools: g.pools.map((p) => ({
        id: p.id,
        label: p.label,
        isMount: p.isMount,
        separated: p.separated,
        withNext: (!p.withParty).toString(),
        food: p.counts.food,
        water: p.counts.water,
        firewood: p.counts.firewood,
      })),
      roster: g.roster.map((r) => ({
        id: r.id,
        name: r.name,
        size: r.isMount ? `Huge ×${r.sizeMult}` : r.sizeMult > 1 ? `×${r.sizeMult}` : "×1",
        zeroNeeds: r.zeroNeeds,
        hunger: fmtClock(r.tracks.hunger),
        thirst: fmtClock(r.tracks.thirst),
        cold: fmtClock(r.tracks.cold),
      })),
    };
  }
}

let instance: GmControlPanel | undefined;
/** Open (or focus) the GM survival panel. */
export function openGmPanel(): void {
  instance ??= new GmControlPanel();
  instance.render({ force: true });
}
