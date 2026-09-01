/**
 * What a session is doing, and what its worker does about it.
 *
 * This file is the whole of the state -> look decision, kept pure and away from the scene so a
 * unit test can assert every row without a renderer. The clip names are the CC0 Quaternius
 * Universal Animation Library's, and the mapping is chosen for legibility from across the room:
 * a blocked session is the only one standing up, which is what makes "who needs me" answerable
 * from a glance rather than from reading six labels.
 */
export type WorkerState = "arriving" | "working" | "thinking" | "blocked" | "idle" | "leaving";

export interface IClipChoice {
  readonly clip: string;
  readonly mode: "loop" | "once";
  /** True when the worker plays this state on its feet rather than in its chair. */
  readonly standing: boolean;
}

const CHOICES: Readonly<Record<WorkerState, IClipChoice>> = {
  // Walking in for the first time: the formal walk is the one that reads as an office.
  arriving: { clip: "Walk_Formal_Loop", mode: "loop", standing: true },
  // The library has no typing clip. The seated driving pose is the one that reads as typing —
  // both hands forward, level, in front of the body — so the keyboard is slid under them rather
  // than the hands being dragged down to it. Bending the arms was tried and swings them open
  // sideways; the pose the animator authored is left alone.
  working: { clip: "Driving_Loop", mode: "loop", standing: false },
  thinking: { clip: "Sitting_Talking_Loop", mode: "loop", standing: false },
  // Standing and on the phone. Deliberately the only standing seated-desk state, because this is
  // the one a human is supposed to notice without being told.
  blocked: { clip: "Idle_TalkingPhone_Loop", mode: "loop", standing: true },
  idle: { clip: "Sitting_Idle_Loop", mode: "loop", standing: false },
  leaving: { clip: "Walk_Loop", mode: "loop", standing: true },
};

/** Sitting down and standing up are one-shots played between the states above. */
export const SIT_DOWN = "Sitting_Enter";
export const STAND_UP = "Sitting_Exit";

export function clipForState(state: WorkerState): IClipChoice {
  const choice = CHOICES[state];
  // Fail closed: an unknown state is a bug in whatever produced it, and a silently substituted
  // idle pose would leave a worker sitting calmly through a session that needs a human.
  if (choice === undefined) throw new Error(`No clip for worker state "${String(state)}".`);
  return choice;
}

/** Every clip the office needs, for a load-time check that the asset actually carries them. */
export function requiredClips(): readonly string[] {
  return [...new Set([...Object.values(CHOICES).map((c) => c.clip), SIT_DOWN, STAND_UP])];
}
