import type { ISessionSummary } from "../../tools/office-bridge/protocol.js";
import type { WorkerState } from "./states.js";

/**
 * Which desk belongs to which session, and what its worker should be doing.
 *
 * Pure, so the seating rules can be asserted without a renderer. Two rules matter: a session keeps
 * its desk for as long as it lives, and a freed desk goes to the next arrival rather than to the
 * lowest index — an office where everyone shuffles seats whenever one person leaves is unreadable.
 */
export interface ISeating {
  /** Desk index per session id. */
  readonly desks: ReadonlyMap<string, number>;
  /** Sessions with no desk left, which the office reports rather than hides. */
  readonly overflow: readonly string[];
}

export function assignDesks(
  sessions: readonly ISessionSummary[],
  deskCount: number,
  previous: ReadonlyMap<string, number>,
): ISeating {
  if (!Number.isInteger(deskCount) || deskCount < 1)
    throw new Error(`An office needs at least one desk, got ${String(deskCount)}.`);
  const desks = new Map<string, number>();
  const taken = new Set<number>();
  for (const session of sessions) {
    const held = previous.get(session.id);
    if (held !== undefined && held < deskCount && !taken.has(held)) {
      desks.set(session.id, held);
      taken.add(held);
    }
  }
  const overflow: string[] = [];
  for (const session of sessions) {
    if (desks.has(session.id)) continue;
    let free = -1;
    for (let index = 0; index < deskCount; index += 1) {
      if (taken.has(index)) continue;
      free = index;
      break;
    }
    if (free === -1) {
      overflow.push(session.id);
      continue;
    }
    desks.set(session.id, free);
    taken.add(free);
  }
  return { desks, overflow };
}

/**
 * The bridge's session state is already the worker's state; this is the seam where that stops
 * being true if either vocabulary ever moves, so it is a named function rather than a cast.
 */
export function workerStateFor(session: ISessionSummary): WorkerState {
  return session.state;
}

/**
 * What a session does with its worker while it has nothing for it to do.
 *
 * An office where every idle session sits perfectly still at its desk reads as a photograph — the
 * room only looks alive when some of them get up. Which session goes where is a pure function of
 * its id, so a worker's habits are stable across snapshots and across reloads: the same session
 * always haunts the same piece of furniture, and no `Math.random()` is involved.
 */
export type IdleActivity = "desk" | "filing" | "faxing";

/** Stable, small, and spread out: a 31-bit string hash, nothing clever. */
export function hashSession(sessionId: string): number {
  let hash = 0;
  for (let index = 0; index < sessionId.length; index += 1)
    hash = (Math.imul(hash, 31) + sessionId.charCodeAt(index)) | 0;
  return Math.abs(hash);
}

export function activityForSession(sessionId: string): IdleActivity {
  const bucket = hashSession(sessionId) % 100;
  // Just over half stay at their desks; the rest split across the furniture the room actually has.
  if (bucket < 55) return "desk";
  if (bucket < 80) return "filing";
  return "faxing";
}

/**
 * A worker's own phase, which is not the session's state.
 *
 * A session is "working" the moment the bridge says so; its worker may still be walking across the
 * floor. Keeping the two apart is what stops a mannequin typing in mid-stride. The activity phases
 * are the same idea at the furniture: walking there, then using it.
 */
export type ActorPhase =
  | "walkingIn"
  | "seated"
  | "walkingToActivity"
  | "atActivity"
  | "walkingOut";
