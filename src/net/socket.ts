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
  img: string;
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

/** One row per castable copy — the spell's own icon + name — so the player just ticks the ones to
 *  cast (three prepared Create Waters = three rows), instead of reading text and typing a number. */
function pickerContent(p: WaterPromptPayload): string {
  let opts = "";
  for (const s of p.spells) {
    for (let i = 0; i < s.maxCasts; i++) {
      opts += `<label class="ss-wc-opt">
        <input type="checkbox" class="ss-wc-pick" data-spell="${escHtml(s.spellId)}">
        <img class="ss-wc-img" src="${escHtml(s.img)}" alt="">
        <span class="ss-wc-lbl">${escHtml(s.label)} <small>${L("SURVIVAL.WaterSpell.Rank", { n: s.rank })}</small></span>
      </label>`;
    }
  }
  return `<div class="ss-wc">
    <p class="ss-wc-hint">${L("SURVIVAL.WaterSpell.PlayerHint", { need: p.deficitUnits, units: p.units })}</p>
    ${opts}
    <p class="ss-wc-total" data-total>${L("SURVIVAL.WaterSpell.Total", { casts: 0, water: 0 })}</p>
  </div>`;
}

function readPicks(dialog: any): WaterCastPick[] {
  const counts = new Map<string, number>();
  (dialog?.element?.querySelectorAll?.(".ss-wc-pick:checked") ?? []).forEach((cb: HTMLInputElement) => {
    const id = cb.dataset.spell!;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  });
  return [...counts.entries()].map(([spellId, count]) => ({ spellId, count }));
}

function wirePicker(dialog: any, units: number): void {
  const root: HTMLElement | null = dialog?.element ?? null;
  if (!root) return;
  const update = () => {
    const casts = root.querySelectorAll(".ss-wc-pick:checked").length;
    const total = root.querySelector("[data-total]");
    if (total) total.textContent = L("SURVIVAL.WaterSpell.Total", { casts, water: casts * units });
  };
  root.querySelectorAll(".ss-wc-pick").forEach((cb: any) => cb.addEventListener("change", update));
  update();
}

/** Ask this player which water spells (and how many casts) to spend. Returns the picks (possibly
 *  empty = declined); null = the dialog was closed without answering (e.g. the GM decided first). */
async function promptWaterCastLocal(p: WaterPromptPayload): Promise<WaterCastPick[] | null> {
  // If you (the player) see this in F12 but no dialog, it's a render error; if you DON'T see it,
  // the socket never reached you (socketlib off, or the GM resolved the row first).
  console.log(`${MODULE_ID} | Create Water: prompt received on this client for ${p.name}`, p.spells);
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

/** True once socketlib has handed us a module socket (i.e. socketlib is installed AND active). */
export function isSocketReady(): boolean {
  return !!socket;
}

/** GM → player: show the cast prompt on the owner's client. Resolves with their per-spell picks. */
export async function promptUserWaterCast(
  userId: string,
  payload: WaterPromptPayload,
): Promise<WaterCastPick[] | null> {
  if (!socket) {
    console.warn(`${MODULE_ID} | Create Water: socketlib not ready — cannot prompt the player. Is socketlib enabled in this world?`);
    return null;
  }
  try {
    console.log(`${MODULE_ID} | Create Water: sending prompt to user ${userId} for ${payload.name}`);
    const res = await socket.executeAsUser("promptWaterCast", userId, payload);
    console.log(`${MODULE_ID} | Create Water: user ${userId} replied`, res);
    return res;
  } catch (e) {
    console.warn(`${MODULE_ID} | Create Water: prompt delivery to user ${userId} failed`, e);
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
