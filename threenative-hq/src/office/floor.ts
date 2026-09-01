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
