import type { WorkerState } from "./office/states.js";

export type GameState = {
  /** Workers currently on the floor — one per live agent session. */
  workerCount: number;
  /** The state of the worker the camera is nearest, for a proof that does not need a click. */
  focusState: WorkerState | "none";
  /** The animation clip that worker is actually playing, read straight off the mixer. */
  focusClip: string;
  /** How many desks the room was furnished with. */
  deskCount: number;
  /** True once the office scene has built its room and its first worker. */
  officeReady: boolean;
  /** Set from the UI's pause and resume intents, and read back by the menu. */
  paused: boolean;
  /** True once the UI layer has rendered and published its interactive rectangles. */
  uiReady: boolean;
};
