import { MODULE_ID } from "../settings";
import { setWarm } from "../state/bridge";

// socketlib wiring: one write authority. A player toggling their own "kept warm" routes the write
// to the GM via executeAsGM, so all shared-state mutations happen on one client. Water-spell
// prompts go the other way: GM → owning player (with a GM override that closes the player dialog).

let socket: any = null;
let refusalLogged = false;

/** Idempotent, self-healing socket acquisition — safe to call from any hook and lazily on demand
 *  (socketlib's registerModule returns the existing socket when called again). Runs on EVERY
 *  client — the player's inbound `promptWaterCast` handler is wired here too, so skipping it
 *  silently breaks prompt delivery in BOTH directions. Returns true once a live socket is held.
 *  registerModule returns `undefined` when it REFUSES: module inactive, or the manifest lacks
 *  `"socket": true` (Foundry's server won't relay `module.<id>` events without it) — the exact
 *  bug that shipped until 1.1.3. */
export function ensureSocket(): boolean {
  if (socket) return true;
  const lib: any = (globalThis as any).socketlib;
  if (!lib?.registerModule) return false; // socketlib not loaded/active yet — retry later
  try {
    const s = lib.registerModule(MODULE_ID);
    if (!s) {
      if (!refusalLogged) {
        refusalLogged = true;
        console.error(
          `${MODULE_ID} | socketlib refused this module's socket — see socketlib's own error above ` +
            `(usually a manifest without "socket": true). Update the module, then relaunch the world.`,
        );
      }
      return false;
    }
    socket = s;
    socket.register("setWarm", (actorUuid: string, warm: boolean) => setWarm(actorUuid, warm));
    socket.register("promptWaterCast", promptWaterCastLocal);
    socket.register("closeWaterPrompt", closeWaterPromptLocal);
    console.log(`${MODULE_ID} | socketlib socket registered (module handlers wired)`);
    return true;
  } catch (e) {
    console.warn(`${MODULE_ID} | socketlib registration failed`, e);
    return false;
  }
}

/** Wire handlers on this client. Safe to call from `socketlib.ready` AND the main `ready` hook. */
export function registerSocket(): void {
  ensureSocket();
}

/** Whether the socketlib module itself is installed AND enabled in this world (vs. our own wiring). */
export function socketlibActive(): boolean {
  return game.modules?.get("socketlib")?.active === true;
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

/** True once we hold a live module socket. Lazily (re)acquires it, so a missed `socketlib.ready`
 *  self-heals the moment the socket is actually needed. */
export function isSocketReady(): boolean {
  return ensureSocket();
}

/** GM → player: show the cast prompt on the owner's client. Resolves with their per-spell picks. */
export async function promptUserWaterCast(
  userId: string,
  payload: WaterPromptPayload,
): Promise<WaterCastPick[] | null> {
  if (!ensureSocket()) {
    console.warn(
      `${MODULE_ID} | Create Water: no socket — cannot prompt the player. socketlib module active=${socketlibActive()}. ` +
        `If active=false, enable socketlib in Manage Modules; if active=true, this is a wiring bug — reload the world.`,
    );
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
  if (!ensureSocket()) return;
  try {
    await socket.executeAsGM("setWarm", actorUuid, warm);
  } catch (e) {
    ui.notifications?.warn(game.i18n.localize("SURVIVAL.NoGM"));
    console.warn(`${MODULE_ID} | setWarm failed`, e);
  }
}
