/**
 * What a session is doing, and what its worker does about it.
 *
 * This file is the whole of the state -> look decision, kept pure and away from the scene so a
 * unit test can assert every row without a renderer. The mapping is chosen for legibility from
 * across the room: a blocked session is the only one standing up away from furniture, which is
 * what makes "who needs me" answerable from a glance rather than from reading six labels.
 *
 * The seated-desk and walk clips come from the CC0 Quaternius Universal Animation Library. The
 * typing, texting and furniture clips are Mixamo takes retargeted onto the same rig by
 * `tools/retarget-mixamo.mjs` into `worker-mixamo.glb`.
 */
export type WorkerState =
  | "arriving"
  | "working"
  | "thinking"
  | "blocked"
  | "idle"
  | "filing"
  | "faxing"
  | "leaving";

export interface IClipChoice {
  readonly clip: string;
  readonly mode: "loop" | "once";
  /** True when the worker plays this state on its feet rather than in its chair. */
  readonly standing: boolean;
}

const CHOICES: Readonly<Record<WorkerState, IClipChoice>> = {
  // Walking in for the first time: the formal walk is the one that reads as an office.
  arriving: { clip: "Walk_Formal_Loop", mode: "loop", standing: true },
  // The Mixamo typing take: both hands over the keyboard, tapping. The Quaternius library has no
  // typing clip at all — the seated driving pose stood in for it and read as a statue from across
  // the room.
  working: { clip: "Typing_Loop", mode: "loop", standing: false },
  thinking: { clip: "Sitting_Talking_Loop", mode: "loop", standing: false },
  // Standing and on the phone. Deliberately the only standing away-from-furniture state, because
  // this is the one a human is supposed to notice without being told.
  blocked: { clip: "Texting_Standing_Loop", mode: "loop", standing: true },
  idle: { clip: "Sitting_Idle_Loop", mode: "loop", standing: false },
  // Idle-session activities away from the desk. Both are standing loops played at their piece of
  // furniture; the scene walks the worker there and back.
  filing: { clip: "Filing_Use_Loop", mode: "loop", standing: true },
  faxing: { clip: "Fax_Use_Loop", mode: "loop", standing: true },
  leaving: { clip: "Walk_Loop", mode: "loop", standing: true },
};

/**
 * The one-shots played between states.
 *
 * `Sitting_Enter` and `Sitting_Exit` are the Quaternius stand<->chair moves. `SitToType` and
 * `TypeToSit` are the Mixamo chair<->keyboard moves, which start and end where Typing_Loop does —
 * so a worker changing between two seated states never leaves its chair through the wrong pose.
 */
export const SIT_DOWN = "Sitting_Enter";
export const STAND_UP = "Sitting_Exit";
export const SIT_TO_TYPE = "SitToType";
export const TYPE_TO_SIT = "TypeToSit";

export function clipForState(state: WorkerState): IClipChoice {
  const choice = CHOICES[state];
  // Fail closed: an unknown state is a bug in whatever produced it, and a silently substituted
  // idle pose would leave a worker sitting calmly through a session that needs a human.
  if (choice === undefined) throw new Error(`No clip for worker state "${String(state)}".`);
  return choice;
}

/** Every clip the office needs, for a load-time check that the assets actually carry them. */
export function requiredClips(): readonly string[] {
  return [
    ...new Set([
      ...Object.values(CHOICES).map((c) => c.clip),
      SIT_DOWN,
      STAND_UP,
      SIT_TO_TYPE,
      TYPE_TO_SIT,
    ]),
  ];
}
