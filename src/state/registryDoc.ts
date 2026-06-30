import { MODULE_ID } from "../settings";
import { emptyRegistry, normalizeRegistry, type RegistryData } from "./registryData";

// The Caravan registry lives in a dedicated, hidden JournalEntry's flags — not a settings blob —
// so writes are atomic/queued (document update pipeline) and a `updateJournalEntry` hook can
// drive re-renders. Stores UUID references only; never embeds actors.
const FLAG = "registry";

export class CaravanRegistry {
  private constructor(private readonly doc: any) {}

  static async findOrCreate(): Promise<CaravanRegistry> {
    const uuid = game.settings.get(MODULE_ID, "caravanDocUuid") as string;
    let doc = uuid ? await fromUuid(uuid) : null;
    if (!doc) {
      doc = await JournalEntry.create({
        name: "Survival Caravan",
        ownership: { default: 0 }, // GM-only
        flags: { [MODULE_ID]: { [FLAG]: emptyRegistry() } },
      });
      await game.settings.set(MODULE_ID, "caravanDocUuid", doc.uuid);
    }
    return new CaravanRegistry(doc);
  }

  load(): RegistryData {
    return normalizeRegistry(this.doc.getFlag(MODULE_ID, FLAG));
  }

  async save(reg: RegistryData): Promise<void> {
    await this.doc.setFlag(MODULE_ID, FLAG, reg);
  }

  get uuid(): string {
    return this.doc.uuid;
  }
}
