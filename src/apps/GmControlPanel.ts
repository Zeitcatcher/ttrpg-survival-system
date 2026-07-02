import type { ClimateBand } from "../core/types";
import { MODULE_ID } from "../settings";
import {
  addBasePool,
  addSelectedTokens,
  advanceDays,
  applyDelvingPreset,
  castConfirmedWaterSpells,
  cookHotMeal,
  editPool,
  forage,
  planWaterCandidates,
  readModel,
  removeBasePool,
  removeMemberFromCaravan,
  resetSurvival,
  setClimate,
  setMemberEnabled,
  setMemberRole,
  setWithParty,
  transferSupply,
  waterSpellUnits,
} from "../state/bridge";
import { buildHeadlineView } from "./headline";
import { negotiateWaterCasts } from "./waterCastDialog";
import type { SurvivalSystemAdapter } from "../systems/adapter";
import { postUpkeepCard } from "./upkeepCard";

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
  if (panelAdapter) {
    // Create Water: dry-run the span; if someone would go thirsty and a caster can help,
    // ask (player prompt + GM override) BEFORE the real tick. Confirmed casts expend slots
    // and add per-day conjured water that expires at each day's end.
    const last = (game.settings.get(MODULE_ID, "lastTickDay") as number) ?? 0;
    const { candidates, deficitUnits } = await planWaterCandidates(panelAdapter, last + days);
    let conjuredWaterPerDay = 0;
    if (candidates.length) {
      const confirmed = await negotiateWaterCasts(candidates, deficitUnits, waterSpellUnits());
      conjuredWaterPerDay = await castConfirmedWaterSpells(panelAdapter, confirmed);
    }
    const result = await advanceDays(days, panelAdapter, conjuredWaterPerDay > 0 ? { conjuredWaterPerDay } : {});
    await postUpkeepCard(result);
  }
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
  await editPool(target.dataset.pool!, target.dataset.kind as "food" | "water" | "firewood", value, panelAdapter);
  this.render();
}
async function onAddSelected(this: any): Promise<void> {
  const n = await addSelectedTokens();
  ui.notifications?.info(game.i18n.format("SURVIVAL.Panel.Added", { n }));
  this.render();
}
async function onSetRole(this: any, _e: Event, target: HTMLElement): Promise<void> {
  await setMemberRole(target.dataset.actor!, target.dataset.mount === "true");
  this.render();
}
async function onToggleMember(this: any, _e: Event, target: HTMLElement): Promise<void> {
  await setMemberEnabled(target.dataset.actor!, target.dataset.enabled === "true");
  this.render();
}
async function onRemoveMember(this: any, _e: Event, target: HTMLElement): Promise<void> {
  const name = target.dataset.name ?? "";
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.localize("SURVIVAL.Panel.Remove") },
    content: `<p>${game.i18n.format("SURVIVAL.Panel.RemoveMemberConfirm", { name })}</p>`,
  }).catch(() => false);
  if (!ok) return;
  await removeMemberFromCaravan(target.dataset.actor!, panelAdapter);
  this.render();
}
async function onRemovePool(this: any, _e: Event, target: HTMLElement): Promise<void> {
  const name = target.dataset.name ?? "";
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.localize("SURVIVAL.Panel.Remove") },
    content: `<p>${game.i18n.format("SURVIVAL.Panel.RemovePoolConfirm", { name })}</p>`,
  }).catch(() => false);
  if (!ok) return;
  await removeBasePool(target.dataset.pool!);
  this.render();
}

const esc = (s: string): string =>
  foundry.utils?.escapeHTML?.(s) ??
  s.replace(/[&<>"]/g, (c: string) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Deliberate sharing (item→item in Ledger mode): pick a target pool, a resource, an amount. */
async function onTransfer(this: any, _e: Event, target: HTMLElement): Promise<void> {
  if (!panelAdapter) return;
  const fromId = target.dataset.pool!;
  const pools = (await readModel(panelAdapter))[0]?.pools ?? [];
  const from = pools.find((p) => p.id === fromId);
  const others = pools.filter((p) => p.id !== fromId);
  if (!from || !others.length) return;

  const kinds = ["food", "water", "firewood"] as const;
  const toOptions = others
    .map((p) => `<option value="${esc(p.id)}">${esc(p.label)}${p.separated ? " ⚠" : ""}</option>`)
    .join("");
  const kindOptions = kinds
    .map((k) => `<option value="${k}">${esc(game.i18n.localize(`SURVIVAL.Resource.${k}`))} (${from.counts[k]})</option>`)
    .join("");
  const row = (label: string, field: string) =>
    `<div class="form-group"><label>${esc(game.i18n.localize(label))}</label>${field}</div>`;

  try {
    const r = await foundry.applications.api.DialogV2.prompt({
      window: { title: `${game.i18n.localize("SURVIVAL.Panel.Transfer")} — ${from.label}` },
      content:
        row("SURVIVAL.Panel.TransferTo", `<select name="to">${toOptions}</select>`) +
        row("SURVIVAL.Panel.TransferKind", `<select name="kind">${kindOptions}</select>`) +
        row("SURVIVAL.Panel.TransferAmount", `<input type="number" name="amount" value="1" min="1" step="1">`),
      ok: {
        label: game.i18n.localize("SURVIVAL.Panel.Transfer"),
        callback: (_ev: Event, button: any) => ({
          to: String(button.form.elements.to.value),
          kind: String(button.form.elements.kind.value) as (typeof kinds)[number],
          amount: Number(button.form.elements.amount.value),
        }),
      },
    });
    if (!r) return;
    const moved = await transferSupply(fromId, r.to, r.kind, r.amount, panelAdapter);
    if (moved > 0) {
      const toLabel = others.find((p) => p.id === r.to)?.label ?? "";
      ui.notifications?.info(
        game.i18n.format("SURVIVAL.Panel.TransferDone", {
          n: moved, kind: game.i18n.localize(`SURVIVAL.Resource.${r.kind}`), from: from.label, to: toLabel,
        }),
      );
    } else {
      ui.notifications?.warn(game.i18n.localize("SURVIVAL.Panel.TransferNone"));
    }
    this.render();
  } catch {
    /* dialog dismissed */
  }
}
async function onAddBase(this: any): Promise<void> {
  const name = await promptText(game.i18n.localize("SURVIVAL.Panel.BaseNameDefault"));
  if (name === null) return;
  await addBasePool(name);
  this.render();
}
async function onReset(this: any): Promise<void> {
  if (!panelAdapter) return;
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.localize("SURVIVAL.Panel.Reset") },
    content: `<p>${game.i18n.localize("SURVIVAL.Panel.ResetConfirm")}</p>`,
  }).catch(() => false);
  if (!ok) return;
  const n = await resetSurvival(panelAdapter, "Main");
  ui.notifications?.info(game.i18n.format("SURVIVAL.Panel.ResetDone", { n }));
  this.render();
}
async function onCook(this: any): Promise<void> {
  if (!panelAdapter) return;
  const n = await cookHotMeal(panelAdapter, "Main");
  if (n === -1) ui.notifications?.warn(game.i18n.localize("SURVIVAL.HotMeal.NoWood"));
  else if (n === 0) ui.notifications?.warn(game.i18n.localize("SURVIVAL.HotMeal.CantCook"));
  else {
    await ChatMessage.create({
      content: `<p>${game.i18n.format("SURVIVAL.HotMeal.Cooked", { n })}</p>`,
      speaker: { alias: game.i18n.localize("SURVIVAL.Panel.Title") },
    });
  }
  this.render();
}
async function onForage(this: any, _e: Event, target: HTMLElement): Promise<void> {
  if (!panelAdapter) return;
  const outcome = await forage(target.dataset.actor!, panelAdapter);
  if (!outcome) {
    ui.notifications?.warn(game.i18n.localize("SURVIVAL.Forage.CantRoll"));
    return;
  }
  const fatigued = outcome.fatigued ? ` <em>${game.i18n.localize("SURVIVAL.Forage.Fatigued")}</em>` : "";
  await ChatMessage.create({
    content: `<p>${game.i18n.format("SURVIVAL.Forage.Result", { name: target.dataset.name ?? "", food: outcome.food })}${fatigued}</p>`,
    speaker: { alias: game.i18n.localize("SURVIVAL.Panel.Title") },
  });
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

async function promptText(initial: string): Promise<string | null> {
  try {
    const value = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize("SURVIVAL.Panel.BaseName") },
      content: `<input type="text" name="value" value="${initial}" autofocus style="width:100%">`,
      ok: {
        label: game.i18n.localize("SURVIVAL.Panel.Set"),
        callback: (_ev: Event, button: any) => String(button.form.elements.value.value ?? "").trim(),
      },
    });
    return typeof value === "string" ? value : null;
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
    id: `${MODULE_ID}-gm`,
    classes: [MODULE_ID, "ss-gm"],
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
      addBase: onAddBase,
      setRole: onSetRole,
      toggleMember: onToggleMember,
      removeMember: onRemoveMember,
      removePool: onRemovePool,
      transfer: onTransfer,
      reset: onReset,
      forage: onForage,
      cook: onCook,
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
      supply: buildHeadlineView(g),
      foragingOn: game.settings.get(MODULE_ID, "foraging") === true,
      hotMealOn: game.settings.get(MODULE_ID, "hotMeal") === true,
      nextWaterDays: (game.settings.get(MODULE_ID, "nextWaterDays") as number) ?? 0,
      supplyModeLabel: game.i18n.localize(
        game.settings.get(MODULE_ID, "supplyDetail") === "ledger" ? "SURVIVAL.Mode.ledger" : "SURVIVAL.Mode.abstract",
      ),
      bands: BANDS.map((b) => ({
        band: b,
        active: b === g.climate,
        label: game.i18n.localize(`SURVIVAL.Band.${b}`),
      })),
      pools: g.pools.map((p) => ({
        id: p.id,
        label: p.label,
        isStorage: p.isStorage,
        separated: p.separated,
        withNext: (!p.withParty).toString(),
        hasOwner: p.hasOwner,
        food: p.counts.food,
        water: p.counts.water,
        firewood: p.counts.firewood,
      })),
      roster: g.roster.map((r) => ({
        id: r.id,
        name: r.name,
        // The REAL size trait ("Gargantuan ×8"), not a hardcoded guess.
        size: r.sizeName ? (r.sizeMult > 1 ? `${r.sizeName} ×${r.sizeMult}` : r.sizeName) : `×${r.sizeMult}`,
        isMount: r.isMount,
        roleNext: (!r.isMount).toString(),
        enabled: r.enabled,
        enabledNext: (!r.enabled).toString(),
        zeroNeeds: r.zeroNeeds,
        // One muted label replaces the three clock cells when the row doesn't consume.
        inactiveLabel: r.zeroNeeds
          ? game.i18n.localize("SURVIVAL.Panel.NoNeeds")
          : !r.enabled
            ? game.i18n.localize("SURVIVAL.Panel.NotConsuming")
            : null,
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
/** Re-render the panel if it's open (e.g. after an actor flag changes). */
export function refreshGmPanel(): void {
  if (instance?.rendered) instance.render();
}
