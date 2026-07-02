import { MODULE_ID } from "../settings";

// Item-sheet dropdown: tag any physical item as a survival resource. The pf2e adapter reads this
// override flag FIRST (before slug/name heuristics), so a GM can point homebrew items at food/
// water/firewood without touching code. Defensive across v13 (HTMLElement) and v1 (jQuery) sheets.

const KINDS = ["auto", "food", "water", "firewood", "none"] as const;

export function registerSheetInjection(): void {
  Hooks.on("renderItemSheetV2", onRender);
  Hooks.on("renderItemSheet", onRender);
}

function isPhysical(item: any): boolean {
  return ["consumable", "equipment", "weapon", "armor", "treasure", "backpack"].includes(item?.type);
}

function onRender(app: any, html: any): void {
  try {
    const item = app?.document ?? app?.object;
    if (!item || !isPhysical(item)) return;
    const root: HTMLElement | null =
      html instanceof HTMLElement ? html : (html?.[0] ?? app?.element ?? null);
    if (!root?.querySelector || root.querySelector(".ss-resource-field")) return;

    const current = item.getFlag?.(MODULE_ID, "resource") ?? "auto";
    const field = document.createElement("div");
    field.className = "ss-resource-field"; // sized as a one-line footer via survival.css

    const label = document.createElement("label");
    label.textContent = game.i18n.localize("SURVIVAL.Item.Resource");

    const select = document.createElement("select");
    for (const k of KINDS) {
      const opt = document.createElement("option");
      opt.value = k;
      opt.textContent = game.i18n.localize(`SURVIVAL.Item.${k}`);
      if (k === current) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener("change", async () => {
      if (select.value === "auto") await item.unsetFlag?.(MODULE_ID, "resource");
      else await item.setFlag?.(MODULE_ID, "resource", select.value);
    });

    field.append(label, select);
    // Anchor to the FORM as a one-line footer below the scrollable body — NOT `.window-content`,
    // which on pf2e V2 sheets is a flex row that stretched this field to fill the whole window.
    const anchor =
      root.querySelector("form") ??
      root.querySelector(".sheet-body") ??
      root.querySelector(".window-content") ??
      root;
    anchor.appendChild(field);
  } catch (e) {
    console.warn(`${MODULE_ID} | item sheet injection failed`, e);
  }
}
