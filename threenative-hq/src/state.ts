import type { WorkerState } from "./office/states.js";

export type GameState = {
  /** Workers currently on the floor — one per live agent session. */
  workerCount: number;
  /** How many desks the room was furnished with. */
  deskCount: number;
  /** True while the office is connected to the bridge daemon. */
  bridgeOnline: boolean;
  /** Sessions that have walked in since the office opened. Counters, so a proof needs no clock. */
  arrivals: number;
  /** Sessions that have left. */
  departures: number;
  /** True once any worker has stood up to take a call — the state a human is meant to notice. */
  blockedSeen: boolean;
  /** The state of the first worker on the floor. */
  focusState: WorkerState | "none";
  /** The clip that worker is actually playing, read straight off the mixer. */
  focusClip: string;
  /** The project that worker is working in. */
  focusProject: string;
  /** True once the office scene has built its room. */
  officeReady: boolean;
  /** Set from the UI's pause and resume intents, and read back by the menu. */
  paused: boolean;
  /** True once the UI layer has rendered and published its interactive rectangles. */
  uiReady: boolean;
};
