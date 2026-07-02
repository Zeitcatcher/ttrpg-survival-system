import { closeUserWaterPrompt, promptUserWaterCast } from "../net/socket";

// The GM-side coordination dialog for Create Water. One row per eligible caster: the owning
// player (if online) simultaneously gets a socket prompt; the GM can override any row with
// Cast/Skip — the first decision wins, and a GM decision closes the player's dialog remotely.

export interface WaterCastCandidate {
  actorUuid: string;
  name: string;
  spellLabel: string;
  /** The owning ACTIVE player, or null (offline / GM-owned) — then the row is GM-only. */
  ownerUserId: string | null;
}

const L = (key: string, data?: Record<string, unknown>): string =>
  data ? game.i18n.format(key, data) : game.i18n.localize(key);

/** Returns the actor uuids to cast for. Undecided rows (dialog closed early) count as skip. */
export async function negotiateWaterCasts(cands: WaterCastCandidate[]): Promise<string[]> {
  if (!cands.length) return [];

  const decisions = new Map<string, boolean>();
  let dialog: any = null;
  let finish: () => void;
  const allDecided = new Promise<void>((resolve) => (finish = resolve));

  const decide = (uuid: string, cast: boolean, byGM: boolean): void => {
    if (decisions.has(uuid)) return; // first decision wins
    decisions.set(uuid, cast);
    const cand = cands.find((c) => c.actorUuid === uuid);
    if (byGM && cand?.ownerUserId) closeUserWaterPrompt(cand.ownerUserId, uuid);
    // Update the row in place (if the dialog is still up).
    const row: HTMLElement | null = dialog?.element?.querySelector?.(`[data-uuid="${uuid}"]`) ?? null;
    if (row) {
      row.querySelectorAll("button").forEach((b: HTMLButtonElement) => (b.disabled = true));
      const state = row.querySelector(".ss-wc-state");
      if (state) state.textContent = cast ? L("SURVIVAL.WaterSpell.WillCast") : L("SURVIVAL.WaterSpell.Skipped");
    }
    if (decisions.size === cands.length) {
      finish();
      dialog?.close?.();
    }
  };

  const rows = cands
    .map((c) => {
      const waiting = c.ownerUserId ? L("SURVIVAL.WaterSpell.WaitingPlayer") : L("SURVIVAL.WaterSpell.PlayerOffline");
      return `<div class="ss-wc-row" data-uuid="${c.actorUuid}">
        <b>${c.name}</b> <span class="ss-wc-spell">${c.spellLabel}</span>
        <span class="ss-wc-state">${waiting}</span>
        <button type="button" data-wc="cast">${L("SURVIVAL.WaterSpell.Cast")}</button>
        <button type="button" data-wc="skip">${L("SURVIVAL.WaterSpell.Decline")}</button>
      </div>`;
    })
    .join("");

  // Fire the player prompts immediately; their answers resolve rows unless the GM got there first.
  for (const c of cands) {
    if (!c.ownerUserId) continue;
    promptUserWaterCast(c.ownerUserId, { actorUuid: c.actorUuid, name: c.name, spell: c.spellLabel })
      .then((answer) => {
        if (answer !== null) decide(c.actorUuid, answer, false);
      })
      .catch(() => undefined);
  }

  const waited = foundry.applications.api.DialogV2.wait({
    window: { title: L("SURVIVAL.WaterSpell.GmTitle") },
    content: `<p>${L("SURVIVAL.WaterSpell.GmHint")}</p>${rows}`,
    buttons: [{ action: "skipRest", label: L("SURVIVAL.WaterSpell.SkipRest"), icon: "fa-solid fa-forward" }],
    render: (_e: any, dlg: any) => {
      dialog = dlg;
      dlg.element?.querySelectorAll?.("[data-wc]").forEach((btn: HTMLElement) => {
        btn.addEventListener("click", () => {
          const uuid = (btn.closest("[data-uuid]") as HTMLElement | null)?.dataset.uuid;
          if (uuid) decide(uuid, btn.dataset.wc === "cast", true);
        });
      });
    },
  }).catch(() => null);

  // The dialog resolving (Skip rest / closed) settles every remaining row as skip.
  await Promise.race([allDecided, waited.then(() => undefined)]);
  for (const c of cands) if (!decisions.has(c.actorUuid)) decide(c.actorUuid, false, true);

  return cands.filter((c) => decisions.get(c.actorUuid) === true).map((c) => c.actorUuid);
}
