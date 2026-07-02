import { requestSetWarm } from "../net/socket";
import { MODULE_ID } from "../settings";
import { readModel } from "../state/bridge";
import type { GroupView, RosterView } from "../state/readModel";
import type { SurvivalSystemAdapter } from "../systems/adapter";

// The players' party HUD: read-mostly. Shows the pool headline and each member's worst status; a
// player can toggle "kept warm" on the character(s) they own (routed to the GM via socketlib).

let hudAdapter: SurvivalSystemAdapter | undefined;
export function setHudAdapter(a: SurvivalSystemAdapter): void {
  hudAdapter = a;
}

async function onToggleWarm(this: any, _e: Event, target: HTMLElement): Promise<void> {
  await requestSetWarm(target.dataset.actor!, target.dataset.warm === "true");
  this.render();
}

function worstStatus(r: RosterView): { label: string; cls: string } {
  let worst = 0;
  let key: string | null = null;
  for (const t of ["hunger", "thirst", "cold"] as const) {
    const tr = r.tracks[t];
    if (tr.stage > worst) {
      worst = tr.stage;
      key = tr.statusKey;
    }
  }
  if (worst === 0 || !key) return { label: game.i18n.localize("SURVIVAL.Hud.Ok"), cls: "ok" };
  return { label: game.i18n.localize(key), cls: worst >= 3 ? "danger" : "warn" };
}

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class PartyHud extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-hud`,
    classes: [MODULE_ID, "ss-hud"],
    tag: "div",
    window: { title: "SURVIVAL.Panel.Title", icon: "fa-solid fa-heart-pulse", resizable: false },
    position: { width: 320 },
    actions: { toggleWarm: onToggleWarm },
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/party-hud.hbs` },
  };

  async _prepareContext(): Promise<any> {
    const groups: GroupView[] = hudAdapter ? await readModel(hudAdapter) : [];
    const g = groups[0];
    if (!g) return { hasData: false };

    return {
      hasData: true,
      headline: g.headline,
      coldActive: g.coldActive,
      roster: g.roster
        .filter((r) => !r.zeroNeeds && r.enabled)
        .map((r) => {
          const actor = fromUuidSync(r.id);
          const warm = !!actor?.getFlag?.(MODULE_ID, "warmth");
          return {
            id: r.id,
            name: r.name,
            owned: actor?.isOwner === true && !game.user?.isGM,
            warm,
            warmNext: (!warm).toString(),
            status: worstStatus(r),
          };
        }),
    };
  }
}

let instance: PartyHud | undefined;
export function openPartyHud(): void {
  instance ??= new PartyHud();
  instance.render({ force: true });
}
export function refreshPartyHud(): void {
  if (instance?.rendered) instance.render();
}
