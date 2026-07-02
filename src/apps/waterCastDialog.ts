import { closeUserWaterPrompt, isSocketReady, promptUserWaterCast } from "../net/socket";
import type { WaterCaster, WaterCastPick, WaterConfirm } from "../state/bridge";

// The GM-side coordination dialog for Create Water. One compact row per eligible caster: the owning
// player (if online) simultaneously gets a per-spell prompt; the GM can override any row with Cast
// max / Cast one / Skip. The first decision wins, and a GM decision closes the player's dialog.

const L = (key: string, data?: Record<string, unknown>): string =>
  data ? game.i18n.format(key, data) : game.i18n.localize(key);
const escHtml = (s: string): string =>
  foundry.utils?.escapeHTML?.(String(s)) ??
  String(s).replace(/[&<>"]/g, (c: string) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const totalCasts = (picks: WaterCastPick[]): number => picks.reduce((a, p) => a + p.count, 0);

/** Returns the confirmed casts (per caster). Undecided rows (dialog closed early) count as skip. */
export async function negotiateWaterCasts(
  candidates: WaterCaster[],
  deficitUnits: number,
  units: number,
): Promise<WaterConfirm[]> {
  if (!candidates.length) return [];

  // If players own casters but socketlib isn't live, they can't be prompted — tell the GM so it's
  // not a silent failure; the GM can still decide every row here.
  if (candidates.some((c) => c.ownerUserId) && !isSocketReady()) {
    ui.notifications?.warn(L("SURVIVAL.WaterSpell.NoSocket"));
  }

  const decisions = new Map<string, WaterCastPick[]>();
  let dialog: any = null;
  let finish: () => void;
  const allDecided = new Promise<void>((resolve) => (finish = resolve));

  const maxPicks = (c: WaterCaster): WaterCastPick[] => c.spells.map((s) => ({ spellId: s.spellId, count: s.maxCasts }));
  const onePick = (c: WaterCaster): WaterCastPick[] => {
    const lowest = [...c.spells].sort((a, b) => a.rank - b.rank)[0];
    return lowest ? [{ spellId: lowest.spellId, count: 1 }] : [];
  };

  const decide = (uuid: string, picks: WaterCastPick[], byGM: boolean): void => {
    if (decisions.has(uuid)) return; // first decision wins
    decisions.set(uuid, picks);
    const cand = candidates.find((c) => c.actorUuid === uuid);
    if (byGM && cand?.ownerUserId) closeUserWaterPrompt(cand.ownerUserId, uuid);

    const row: HTMLElement | null = dialog?.element?.querySelector?.(`[data-uuid="${uuid}"]`) ?? null;
    if (row) {
      row.querySelectorAll("button").forEach((b: HTMLButtonElement) => (b.disabled = true));
      const state = row.querySelector(".ss-wc-state");
      const casts = totalCasts(picks);
      if (state) {
        state.textContent = casts > 0 ? L("SURVIVAL.WaterSpell.WillCast", { casts, water: casts * units }) : L("SURVIVAL.WaterSpell.Skipped");
      }
    }
    if (decisions.size === candidates.length) {
      finish();
      dialog?.close?.();
    }
  };

  // Fire the player prompts immediately; their picks resolve rows unless the GM got there first.
  for (const c of candidates) {
    if (!c.ownerUserId) continue;
    promptUserWaterCast(c.ownerUserId, { actorUuid: c.actorUuid, name: c.name, spells: c.spells, units, deficitUnits })
      .then((picks) => {
        if (picks !== null) decide(c.actorUuid, picks, false);
      })
      .catch(() => undefined);
  }

  const rowHtml = (c: WaterCaster): string => {
    const avail = c.spells.reduce((a, s) => a + s.maxCasts, 0);
    const status = c.ownerUserId ? L("SURVIVAL.WaterSpell.WaitingPlayer") : L("SURVIVAL.WaterSpell.PlayerOffline");
    const summary = c.spells.map((s) => `${escHtml(s.label)} ×${s.maxCasts}`).join(", ");
    return `<div class="ss-wc-row" data-uuid="${escHtml(c.actorUuid)}">
      <span class="ss-wc-name"><b>${escHtml(c.name)}</b> <span class="ss-wc-rank">${summary}</span></span>
      <span class="ss-wc-state">${status}</span>
      <span class="ss-wc-ctl">
        <button type="button" data-wc="max">${L("SURVIVAL.WaterSpell.CastMax", { water: avail * units })}</button>
        <button type="button" data-wc="one">${L("SURVIVAL.WaterSpell.CastOne")}</button>
        <button type="button" data-wc="skip">${L("SURVIVAL.WaterSpell.Decline")}</button>
      </span>
    </div>`;
  };

  const waited = foundry.applications.api.DialogV2.wait({
    window: { title: L("SURVIVAL.WaterSpell.GmTitle") },
    position: { width: 480 },
    content: `<div class="ss-wc"><p class="ss-wc-hint">${L("SURVIVAL.WaterSpell.GmHint", { need: deficitUnits, units })}</p>${candidates.map(rowHtml).join("")}</div>`,
    buttons: [{ action: "skipRest", label: L("SURVIVAL.WaterSpell.SkipRest"), icon: "fa-solid fa-forward" }],
    render: (_e: any, dlg: any) => {
      dialog = dlg;
      dlg.element?.querySelectorAll?.("[data-wc]").forEach((btn: HTMLElement) => {
        btn.addEventListener("click", () => {
          const uuid = (btn.closest("[data-uuid]") as HTMLElement | null)?.dataset.uuid;
          const cand = candidates.find((c) => c.actorUuid === uuid);
          if (!uuid || !cand) return;
          const mode = btn.dataset.wc;
          decide(uuid, mode === "max" ? maxPicks(cand) : mode === "one" ? onePick(cand) : [], true);
        });
      });
    },
  }).catch(() => null);

  // The dialog resolving (Skip rest / closed) settles every remaining row as skip.
  await Promise.race([allDecided, waited.then(() => undefined)]);
  for (const c of candidates) if (!decisions.has(c.actorUuid)) decide(c.actorUuid, [], true);

  return candidates
    .map((c) => ({ actorUuid: c.actorUuid, casts: decisions.get(c.actorUuid) ?? [] }))
    .filter((x) => x.casts.length > 0);
}
