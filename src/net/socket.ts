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

/** Open prompt dialogs by actor uuid, so a GM override can close them remotely. */
const openWaterPrompts = new Map<string, any>();

/** Ask this player: cast the water spell for their character? true/false = player's answer;
 *  null = the dialog was closed without an answer (e.g. the GM decided first). */
async function promptWaterCastLocal(p: { actorUuid: string; name: string; spell: string }): Promise<boolean | null> {
  try {
    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.localize("SURVIVAL.WaterSpell.PromptTitle") },
      content: `<p>${game.i18n.format("SURVIVAL.WaterSpell.PromptBody", { name: p.name, spell: p.spell })}</p>`,
      buttons: [
        { action: "yes", label: game.i18n.localize("SURVIVAL.WaterSpell.Cast"), icon: "fa-solid fa-droplet", default: true },
        { action: "no", label: game.i18n.localize("SURVIVAL.WaterSpell.Decline"), icon: "fa-solid fa-xmark" },
      ],
      render: (_e: any, dialog: any) => openWaterPrompts.set(p.actorUuid, dialog),
    });
    return result === "yes" ? true : result === "no" ? false : null;
  } catch {
    return null; // dismissed / closed by the GM's decision
  } finally {
    openWaterPrompts.delete(p.actorUuid);
  }
}

/** The GM decided — close this player's pending dialog, if still open. */
function closeWaterPromptLocal(actorUuid: string): void {
  openWaterPrompts.get(actorUuid)?.close?.();
  openWaterPrompts.delete(actorUuid);
}

/** GM → player: show the cast prompt on the owner's client. Resolves with their answer. */
export async function promptUserWaterCast(
  userId: string,
  payload: { actorUuid: string; name: string; spell: string },
): Promise<boolean | null> {
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
