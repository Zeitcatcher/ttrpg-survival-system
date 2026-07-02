import { MODULE_ID } from "../settings";
import { setWarm } from "../state/bridge";

// socketlib wiring: one write authority. A player toggling their own "kept warm" routes the write
// to the GM via executeAsGM, so all shared-state mutations happen on one client. Water-spell
// prompts go the other way: GM → owning player (with a GM override that closes the player dialog).

let socket: any;

/** Register handlers on EVERY client. Must run in the `socketlib.ready` hook (not core init). */
export function registerSocket(): void {
  socket = socketlib.registerModule(MODULE_ID);
  socket.register("setWarm", (actorUuid: string, warm: boolean) => setWarm(actorUuid, warm));
  socket.register("promptWaterCast", promptWaterCastLocal);
  socket.register("closeWaterPrompt", closeWaterPromptLocal);
}

// ---- Water-spell player prompts (run on the OWNING PLAYER's client) ----

export interface WaterSpellOption {
  spellId: string;
  label: string;
  rank: number;
  maxCasts: number;
}
export interface WaterCastPick {
  spellId: string;
  count: number;
}
export interface WaterPromptPayload {
  actorUuid: string;
  name: string;
  spells: WaterSpellOption[];
  units: number;
  deficitUnits: number;
}

const L = (key: string, data?: Record<string, unknown>): string =>
  data ? game.i18n.format(key, data) : game.i18n.localize(key);
const escHtml = (s: string): string =>
  foundry.utils?.escapeHTML?.(String(s)) ??
  String(s).replace(/[&<>"]/g, (c: string) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Open prompt dialogs by actor uuid, so a GM override can close them remotely. */
const openWaterPrompts = new Map<string, any>();

function pickerContent(p: WaterPromptPayload): string {
  const rows = p.spells
    .map(
      (s) => `<div class="ss-wc-row" data-spell="${escHtml(s.spellId)}">
        <span class="ss-wc-name">${escHtml(s.label)} <span class="ss-wc-rank">${L("SURVIVAL.WaterSpell.Rank", { n: s.rank })}</span></span>
        <span class="ss-wc-ctl">
          <button type="button" class="ss-wc-step" data-d="-1">−</button>
          <input type="number" class="ss-wc-count" min="0" max="${s.maxCasts}" value="0" inputmode="numeric">
          <span class="ss-wc-max">/ ${s.maxCasts}</span>
          <button type="button" class="ss-wc-step" data-d="1">+</button>
        </span>
      </div>`,
    )
    .join("");
  return `<div class="ss-wc">
    <p class="ss-wc-hint">${L("SURVIVAL.WaterSpell.PlayerHint", { need: p.deficitUnits, units: p.units })}</p>
    ${rows}
    <p class="ss-wc-total" data-total>${L("SURVIVAL.WaterSpell.Total", { casts: 0, water: 0 })}</p>
  </div>`;
}

function readPicks(dialog: any): WaterCastPick[] {
  const picks: WaterCastPick[] = [];
  (dialog?.element?.querySelectorAll?.(".ss-wc-row") ?? []).forEach((row: HTMLElement) => {
    const input = row.querySelector(".ss-wc-count") as HTMLInputElement | null;
    const n = Math.max(0, Math.floor(Number(input?.value ?? 0)));
    if (n > 0) picks.push({ spellId: row.dataset.spell!, count: n });
  });
  return picks;
}

function wirePicker(dialog: any, units: number): void {
  const root: HTMLElement | null = dialog?.element ?? null;
  if (!root) return;
  const clamp = (input: HTMLInputElement) => {
    let v = Math.floor(Number(input.value || 0));
    const max = Number(input.max || 0);
    if (!Number.isFinite(v) || v < 0) v = 0;
    if (v > max) v = max;
    input.value = String(v);
  };
  const updateTotal = () => {
    let casts = 0;
    root.querySelectorAll(".ss-wc-count").forEach((i: any) => (casts += Math.max(0, Math.floor(Number(i.value || 0)))));
    const total = root.querySelector("[data-total]");
    if (total) total.textContent = L("SURVIVAL.WaterSpell.Total", { casts, water: casts * units });
  };
  root.querySelectorAll(".ss-wc-step").forEach((btn: any) =>
    btn.addEventListener("click", () => {
      const input = btn.parentElement?.querySelector(".ss-wc-count") as HTMLInputElement | null;
      if (!input) return;
      input.value = String(Math.floor(Number(input.value || 0)) + Number(btn.dataset.d));
      clamp(input);
      updateTotal();
    }),
  );
  root.querySelectorAll(".ss-wc-count").forEach((i: any) =>
    i.addEventListener("input", () => {
      clamp(i);
      updateTotal();
    }),
  );
  updateTotal();
}

/** Ask this player which water spells (and how many casts) to spend. Returns the picks (possibly
 *  empty = declined); null = the dialog was closed without answering (e.g. the GM decided first). */
async function promptWaterCastLocal(p: WaterPromptPayload): Promise<WaterCastPick[] | null> {
  try {
    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: L("SURVIVAL.WaterSpell.PromptTitle") },
      position: { width: 400 },
      content: pickerContent(p),
      buttons: [
        {
          action: "cast", label: L("SURVIVAL.WaterSpell.Cast"), icon: "fa-solid fa-droplet", default: true,
          callback: (_e: any, _b: any, dialog: any) => readPicks(dialog),
        },
        { action: "no", label: L("SURVIVAL.WaterSpell.Decline"), icon: "fa-solid fa-xmark" },
      ],
      render: (_e: any, dialog: any) => {
        openWaterPrompts.set(p.actorUuid, dialog);
        wirePicker(dialog, p.units);
      },
    });
    return Array.isArray(result) ? result : []; // "no"/closed-normally = decided to cast nothing
  } catch {
    return null; // GM closed it remotely / dismissed
  } finally {
    openWaterPrompts.delete(p.actorUuid);
  }
}

/** The GM decided — close this player's pending dialog, if still open. */
function closeWaterPromptLocal(actorUuid: string): void {
  openWaterPrompts.get(actorUuid)?.close?.();
  openWaterPrompts.delete(actorUuid);
}

/** GM → player: show the cast prompt on the owner's client. Resolves with their per-spell picks. */
export async function promptUserWaterCast(
  userId: string,
  payload: WaterPromptPayload,
): Promise<WaterCastPick[] | null> {
  if (!socket) return null;
  try {
    return await socket.executeAsUser("promptWaterCast", userId, payload);
  } catch (e) {
    console.warn(`${MODULE_ID} | promptWaterCast failed`, e);
    return null;
  }
}

/** GM → player: withdraw the prompt (the GM has decided). Fire-and-forget. */
export function closeUserWaterPrompt(userId: string, actorUuid: string): void {
  try {
    socket?.executeAsUser("closeWaterPrompt", userId, actorUuid);
  } catch {
    /* the player may have disconnected — nothing to close */
  }
}

/** Player → GM: set a creature's warmth. Falls back gracefully if no GM is connected. */
export async function requestSetWarm(actorUuid: string, warm: boolean): Promise<void> {
  if (!socket) return;
  try {
    await socket.executeAsGM("setWarm", actorUuid, warm);
  } catch (e) {
    ui.notifications?.warn(game.i18n.localize("SURVIVAL.NoGM"));
    console.warn(`${MODULE_ID} | setWarm failed`, e);
  }
}
