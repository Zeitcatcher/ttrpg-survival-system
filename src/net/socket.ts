import { MODULE_ID } from "../settings";
import { setWarm } from "../state/bridge";

// socketlib wiring: one write authority. A player toggling their own "kept warm" routes the write
// to the GM via executeAsGM, so all shared-state mutations happen on one client.

let socket: any;

/** Register handlers on EVERY client. Must run in the `socketlib.ready` hook (not core init). */
export function registerSocket(): void {
  socket = socketlib.registerModule(MODULE_ID);
  socket.register("setWarm", (actorUuid: string, warm: boolean) => setWarm(actorUuid, warm));
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
