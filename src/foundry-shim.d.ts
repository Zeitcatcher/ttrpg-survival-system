// Minimal ambient declarations for the Foundry VTT globals the module entry references.
// These are intentionally loose (`any`) so the scaffold typechecks without pulling the full
// community type package yet. Real Foundry types can be layered in later (see implementation plan).
// The system-neutral core (src/core) touches NONE of these — that is the point.

declare const Hooks: any;
declare const game: any;
declare const ui: any;
declare const socketlib: any;
declare const CONFIG: any;
declare const foundry: any;
declare const JournalEntry: any;
declare const ChatMessage: any;
declare const canvas: any;
declare function fromUuid(uuid: string): Promise<any>;
declare function fromUuidSync(uuid: string): any;

interface Window {
  game: any;
  Hooks: any;
}
