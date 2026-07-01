import type { TickResult } from "../core/engine";
import { MODULE_ID } from "../settings";
import { buildUpkeepSummary, type UpkeepSummary } from "../state/upkeepSummary";

// The daily upkeep card: a chat summary posted after a tick. Green days (no shortfall) are
// suppressed to a single quiet GM whisper (Decision F); shortfall days post a full card to the GM
// plus a private nudge to each affected player. A multi-day advance yields ONE consolidated card.

const ICON: Record<string, string> = { food: "🍖", water: "💧", firewood: "🔥" };
const L = (key: string, data?: Record<string, unknown>): string =>
  data ? game.i18n.format(key, data) : game.i18n.localize(key);

export async function postUpkeepCard(result: TickResult, group = "Main"): Promise<void> {
  const summary = buildUpkeepSummary(result, group);
  const mode = game.settings.get(MODULE_ID, "upkeepPrompt");

  if (summary.allGreen && mode === "onlyWhenWrong") {
    await whisperGM(`<p class="ss-card-green">${L("SURVIVAL.Card.Green", { days: summary.daysProcessed })}</p>`);
    return;
  }

  await whisperGM(renderCard(summary));
  await nudgeOwners(summary);
}

function renderCard(s: UpkeepSummary): string {
  const parts: string[] = [`<div class="ss-card"><h3>${L("SURVIVAL.Card.Title", { days: s.daysProcessed })}</h3>`];
  parts.push(
    `<p class="ss-card-consumed">${ICON.food} ${s.consumed.food} · ${ICON.water} ${s.consumed.water} · ${ICON.firewood} ${s.consumed.firewood}</p>`,
  );
  if (s.overflow) parts.push(`<p class="ss-card-warn">${L("SURVIVAL.Card.Overflow")}</p>`);

  if (s.shortfalls.length) {
    parts.push(`<div class="ss-card-short"><b>${L("SURVIVAL.Card.WentWithout")}</b><ul>`);
    for (const sf of s.shortfalls) {
      const cause = L(sf.cause === "separated" ? "SURVIVAL.Shortfall.separatedShort" : "SURVIVAL.Shortfall.outShort");
      const tag = sf.isMountNarrateOnly ? ` <em>(${L("SURVIVAL.Card.Narrate")})</em>` : "";
      parts.push(`<li>${ICON[sf.kind]} <b>${sf.name}</b> — ${cause}${tag}</li>`);
    }
    parts.push(`</ul></div>`);
  }

  if (s.clocks.length) {
    parts.push(`<div class="ss-card-clocks"><b>${L("SURVIVAL.Card.Clocks")}</b><ul>`);
    for (const c of s.clocks) parts.push(`<li><b>${c.name}</b> — ${L(c.statusKey)}</li>`);
    parts.push(`</ul></div>`);
  }

  parts.push(`</div>`);
  return parts.join("");
}

async function whisperGM(content: string): Promise<void> {
  await ChatMessage.create({
    content,
    whisper: ChatMessage.getWhisperRecipients("GM"),
    speaker: { alias: L("SURVIVAL.Panel.Title") },
  });
}

async function nudgeOwners(s: UpkeepSummary): Promise<void> {
  for (const sf of s.shortfalls) {
    if (sf.isMountNarrateOnly) continue;
    const actor = fromUuidSync(sf.actorUuid);
    if (!actor) continue;
    const owners = (game.users ?? []).filter(
      (u: any) => !u.isGM && actor.testUserPermission?.(u, "OWNER"),
    );
    if (!owners.length) continue;
    await ChatMessage.create({
      content: `<p>${L("SURVIVAL.Card.Nudge", { kind: L(`SURVIVAL.Resource.${sf.kind}`) })}</p>`,
      whisper: owners.map((u: any) => u.id),
      speaker: { alias: L("SURVIVAL.Panel.Title") },
    });
  }
}
