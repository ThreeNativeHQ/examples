/**
 * Everything the HUD, the playtest runner and a native UI are allowed to read.
 *
 * Only JSON-safe values: the bridge flushes this store at about 10 Hz and a scenario asserts
 * against these paths by name, so a value that is not here does not exist as far as proof is
 * concerned.
 */
export type GameState = {
  /** Solid crates in the vault — the ones the warden cannot walk through. */
  crates: number;
  /** Phase crates — the ones it can. */
  phaseCrates: number;
  /** Dynamic bodies whose linear speed is under the rest threshold this frame. */
  settledCrates: number;
  /** True once every dynamic body has been at rest at the same time, after the opening drop. */
  settled: boolean;
  /** Solid crates displaced more than a quarter metre from where the drop left them. */
  pushedCrates: number;
  /** Metres the furthest-shoved crate has travelled since the vault settled. */
  pushDistance: number;
  /** Ticks the warden asked to move and the solver refused most of it — a body was in the way. */
  blockedTicks: number;
  /** Times the warden's body entered a phase crate's volume without being stopped by it. */
  passThroughs: number;
  /** Contacts the seal area has recorded, warden or crate. */
  sealContacts: number;
  /** What last touched the seal: nothing yet, the warden, or a crate it shoved in. */
  sealedBy: "crate" | "none" | "warden";
  /** Metres walked. */
  odometer: number;
  playerX: number;
  playerZ: number;
  /** Set from the UI's pause and resume intents, and read back by the menu. */
  paused: boolean;
  /** The deterministic double-run check: idle until V, then first, second, done. */
  replayPhase: "done" | "first" | "idle" | "second";
  /** True only once both passes ran and their final-state digests were identical. */
  replayMatch: boolean;
  /** Fixed-step ticks each replay pass runs. */
  replayTicks: number;
  /** The world seed the vault was built from. */
  seed: number;
  /** The run: "playing" until the seal is reached, then "won" and it stays "won". */
  status: "playing" | "won";
  /** True once the UI layer has rendered and published its interactive rectangles. */
  uiReady: boolean;
};
