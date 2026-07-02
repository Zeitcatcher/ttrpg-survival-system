import type { DeathEvent, TickResult } from "../core/engine";
import { MODULE_ID } from "../settings";
import type { SurvivalSystemAdapter } from "../systems/adapter";

// Survival mode's terminal step. When a tick reports characters at the fatal stage, the GM gets ONE
// prompt per character — Confirm death / Knock to Dying / Spare — so no PC ever dies from a
// background tick without a deliberate click. Runs on the GM client (the tick's caller); no sockets.

const L = (key: string, data?: Record<string, unknown>): string =>
  data ? game.i18n.format(key, data) : game.i18n.localize(key);
const escHtml = (s: string): string =>
  foundry.utils?.escapeHTML?.(String(s)) ??
  String(s).replace(/[&<>"]/g, (c: string) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** "of thirst" / "of hunger" / "of the cold" — joined when several tracks are fatal at once. */
function causePhrase(tracks: string[]): string {
  return tracks.map((t) => L(`SURVIVAL.Death.cause.${t}`)).join(", ");
}

/** Public chat announcement that a character has died or collapsed. */
async function announce(key: string, name: string, cause: string): Promise<void> {
  const content =
    `<div class="ss-death-card"><h3>${escHtml(L("SURVIVAL.Death.cardTitle"))}</h3>` +
    `<p>${escHtml(L(key, { name, cause }))}</p></div>`;
  await ChatMessage.create?.({ content, flags: { [MODULE_ID]: { death: true } } });
}

async function resolveOne(d: DeathEvent, adapter: SurvivalSystemAdapter): Promise<void> {
  const actor: any = await fromUuid(d.consumerId);
  if (!actor) return;
  const name = actor.name ?? d.name;
  const cause = causePhrase(d.tracks);

  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: L("SURVIVAL.Death.dialogTitle") },
    position: { width: 460 },
    content: `<div class="ss-death"><p>${escHtml(L("SURVIVAL.Death.prompt", { name, cause }))}</p></div>`,
    buttons: [
      { action: "kill", label: L("SURVIVAL.Death.confirm"), icon: "fa-solid fa-skull", default: true },
      { action: "dying", label: L("SURVIVAL.Death.dying"), icon: "fa-solid fa-heart-crack" },
      { action: "spare", label: L("SURVIVAL.Death.spare"), icon: "fa-solid fa-hand" },
    ],
  }).catch(() => "spare"); // dismissing the dialog = spare (never an accidental kill)

  if (choice === "kill") {
    await adapter.applyDeath?.(actor);
    await announce("SURVIVAL.Death.died", name, cause);
  } else if (choice === "dying") {
    await adapter.applyDying?.(actor);
    await announce("SURVIVAL.Death.collapsed", name, cause);
  }
  // "spare" → nothing: the character holds at death's door and is re-offered next advance if still deprived.
}

/** GM-confirm every fatal-stage character from a tick, one dialog at a time. No-op unless days were
 *  actually processed and the run is climbToDeath (only then does `deaths` populate). */
export async function resolveDeaths(result: TickResult, adapter: SurvivalSystemAdapter): Promise<void> {
  if (!game.user?.isGM || !result.daysProcessed || !result.deaths?.length) return;
  for (const d of result.deaths) await resolveOne(d, adapter);
}
