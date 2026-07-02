import type { TickResult } from "../core/engine";
import { MODULE_ID } from "../settings";
import { buildUpkeepSummary, type UpkeepSummary } from "../state/upkeepSummary";

// The daily upkeep card: exactly ONE chat message per tick, grouped BY CHARACTER (each affected
// creature gets a section listing what it went without + its current clocks). Green days (nothing
// wrong) collapse to a single quiet GM whisper. A multi-day advance still yields one card.

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
}

interface ActorEntry {
  name: string;
  narrate: boolean;
  shortfalls: { kind: string; cause: string }[];
  clocks: { track: string; statusKey: string; stage: number }[];
}

function renderCard(s: UpkeepSummary): string {
  const parts: string[] = [`<div class="ss-card"><h3>${L("SURVIVAL.Card.Title", { days: s.daysProcessed })}</h3>`];
  parts.push(
    `<p class="ss-card-consumed">${ICON.food} ${s.consumed.food} · ${ICON.water} ${s.consumed.water} · ${ICON.firewood} ${s.consumed.firewood}</p>`,
  );
  if (s.overflow) parts.push(`<p class="ss-card-warn">${L("SURVIVAL.Card.Overflow")}</p>`);

  // Merge shortfalls + clocks into ONE entry per character — the whole point is a single, readable
  // message split by character rather than a flat wall (or many messages).
  const byActor = new Map<string, ActorEntry>();
  const entryFor = (uuid: string, name: string): ActorEntry => {
    let e = byActor.get(uuid);
    if (!e) {
      e = { name, narrate: false, shortfalls: [], clocks: [] };
      byActor.set(uuid, e);
    }
    return e;
  };
  for (const sf of s.shortfalls) {
    const e = entryFor(sf.actorUuid, sf.name);
    e.shortfalls.push({ kind: sf.kind, cause: sf.cause });
    if (sf.isMountNarrateOnly) e.narrate = true;
  }
  for (const c of s.clocks) {
    entryFor(c.actorUuid, c.name).clocks.push({ track: c.track, statusKey: c.statusKey, stage: c.stage });
  }

  if (byActor.size) {
    parts.push(`<div class="ss-card-actors">`);
    for (const e of byActor.values()) {
      const tag = e.narrate ? ` <em>(${L("SURVIVAL.Card.Narrate")})</em>` : "";
      parts.push(`<div class="ss-card-actor"><b>${e.name}</b>${tag}<ul>`);
      for (const sf of e.shortfalls) {
        const cause = L(sf.cause === "separated" ? "SURVIVAL.Shortfall.separatedShort" : "SURVIVAL.Shortfall.outShort");
        parts.push(`<li class="short">${ICON[sf.kind]} ${L(`SURVIVAL.Resource.${sf.kind}`)} — ${cause}</li>`);
      }
      for (const c of e.clocks) {
        parts.push(`<li class="clock">${L(`SURVIVAL.Status.${c.track}.label`)}: ${L(c.statusKey)} (${c.stage})</li>`);
      }
      parts.push(`</ul></div>`);
    }
    parts.push(`</div>`);
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
