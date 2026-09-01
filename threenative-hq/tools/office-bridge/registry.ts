/**
 * Who is on the floor, and how sure we are.
 *
 * Two lanes feed this: hooks, which say exactly what a session is doing the moment it does it, and
 * the transcript tailer, which can only tell that something moved. Hooks outrank transcripts, and
 * a transcript scan never overwrites a hook-driven state — otherwise a two-second poll would keep
 * standing a blocked session back down into "thinking" and the one state a human needs to see
 * would flicker away.
 */
import type { IProcessSession } from "./processes.js";
import {
  type ISessionSummary,
  type IOfficeSnapshot,
  type ISessionEvent,
  stateForEvent,
} from "./protocol.js";

export interface IRegistryOptions {
  /** No signal for this long and the worker leaves. */
  readonly departAfterMs?: number;
  /** A hook-driven session with no event for this long falls back to the observed lanes. */
  readonly hookAuthorityMs?: number;
  /** CPU milliseconds between scans above which a session counts as working. */
  readonly busyCpuMs?: number;
  readonly now?: () => number;
}

export type RegistryChange =
  | { readonly kind: "upsert"; readonly session: ISessionSummary }
  | { readonly kind: "gone"; readonly id: string };

export class OfficeRegistry {
  readonly #sessions = new Map<string, ISessionSummary>();
  /** Last CPU reading per session, so "is it doing anything" is a difference, not a guess. */
  readonly #cpu = new Map<string, number>();
  readonly #departAfterMs: number;
  readonly #hookAuthorityMs: number;
  readonly #busyCpuMs: number;
  readonly #now: () => number;
  readonly startedMs: number;

  constructor(options: IRegistryOptions = {}) {
    this.#departAfterMs = options.departAfterMs ?? 90_000;
    this.#hookAuthorityMs = options.hookAuthorityMs ?? 120_000;
    // 40 ms of CPU between two scans two seconds apart. An agent generating tokens or running a
    // tool clears this easily; one parked at a prompt does not.
    this.#busyCpuMs = options.busyCpuMs ?? 40;
    this.#now = options.now ?? (() => Date.now());
    this.startedMs = this.#now();
  }

  get size(): number {
    return this.#sessions.size;
  }

  snapshot(): IOfficeSnapshot {
    return {
      kind: "snapshot",
      serverStartedMs: this.startedMs,
      // Stable order: a desk should not change occupant because a Map iterated differently.
      sessions: [...this.#sessions.values()].sort((a, b) => a.startedMs - b.startedMs || (a.id < b.id ? -1 : 1)),
    };
  }

  /** A hook spoke. This is the authoritative lane. */
  applyEvent(event: ISessionEvent): RegistryChange {
    const now = this.#now();
    const id = `${event.host}:${event.sessionId}`;
    if (event.kind === "end") {
      const existing = this.#sessions.get(id);
      if (existing === undefined) return { id, kind: "gone" };
      this.#sessions.delete(id);
      return { id, kind: "gone" };
    }
    const previous = this.#sessions.get(id);
    const cwd = event.cwd ?? previous?.cwd ?? "unknown";
    const session: ISessionSummary = {
      cwd,
      host: event.host,
      id,
      lastSeenMs: now,
      project: projectOf(cwd),
      source: "hook",
      startedMs: previous?.startedMs ?? now,
      state: stateForEvent(event.kind),
      ...(event.tool === undefined ? {} : { tool: event.tool }),
      ...(event.model ?? previous?.model === undefined
        ? {}
        : { model: event.model ?? previous?.model }),
    };
    this.#sessions.set(id, session);
    return { kind: "upsert", session };
  }

  /**
   * The process table was read. This is the liveness lane: what is here is on the floor, what is
   * missing has left, and nothing lingers on a timer.
   *
   * State comes from CPU time between scans, unless a hook has spoken recently — a hook knows the
   * difference between "waiting for a human" and "waiting for a model", and CPU time never will.
   */
  applyProcesses(observed: readonly IProcessSession[]): readonly RegistryChange[] {
    const now = this.#now();
    const changes: RegistryChange[] = [];
    const seen = new Set<string>();
    for (const candidate of observed) {
      seen.add(candidate.id);
      const previous = this.#sessions.get(candidate.id);
      const previousCpu = this.#cpu.get(candidate.id);
      this.#cpu.set(candidate.id, candidate.cpuMs);
      const busy = previousCpu !== undefined && candidate.cpuMs - previousCpu > this.#busyCpuMs;
      const hookDriven =
        previous !== undefined &&
        previous.source === "hook" &&
        now - previous.lastSeenMs < this.#hookAuthorityMs;
      const state = hookDriven ? previous.state : busy ? "working" : (previous?.state === "arriving" ? "arriving" : "idle");
      const session: ISessionSummary = {
        cwd: candidate.cwd,
        host: candidate.host,
        id: candidate.id,
        lastSeenMs: now,
        project: candidate.project,
        source: hookDriven ? "hook" : "process",
        startedMs: previous?.startedMs ?? candidate.startedMs,
        state,
        ...(previous?.tool === undefined ? {} : { tool: previous.tool }),
        ...(candidate.model ?? previous?.model === undefined
          ? {}
          : { model: candidate.model ?? previous?.model }),
      };
      const unchanged =
        previous !== undefined &&
        previous.state === session.state &&
        previous.cwd === session.cwd &&
        previous.source === session.source;
      this.#sessions.set(session.id, session);
      if (!unchanged) changes.push({ kind: "upsert", session });
    }
    for (const [id, session] of this.#sessions) {
      // A hook-driven session whose process is gone still leaves; the process table is the only
      // thing that can say a session ended without being told.
      if (seen.has(id)) continue;
      if (session.source === "hook" && now - session.lastSeenMs < this.#hookAuthorityMs) continue;
      this.#sessions.delete(id);
      this.#cpu.delete(id);
      changes.push({ id, kind: "gone" });
    }
    return changes;
  }

  /** A transcript scan finished. Only fills in what the hooks have not claimed. */
  applyTranscripts(observed: readonly ISessionSummary[]): readonly RegistryChange[] {
    const now = this.#now();
    const changes: RegistryChange[] = [];
    for (const candidate of observed) {
      const previous = this.#sessions.get(candidate.id);
      if (previous !== undefined && previous.source === "hook") {
        // Still hook-driven: refresh liveness only, and let its own events set the state.
        if (now - previous.lastSeenMs < this.#hookAuthorityMs) {
          if (candidate.lastSeenMs > previous.lastSeenMs) {
            const session = { ...previous, lastSeenMs: candidate.lastSeenMs };
            this.#sessions.set(candidate.id, session);
            changes.push({ kind: "upsert", session });
          }
          continue;
        }
      }
      const session: ISessionSummary = {
        ...candidate,
        startedMs: previous?.startedMs ?? candidate.startedMs,
      };
      if (
        previous !== undefined &&
        previous.state === session.state &&
        previous.lastSeenMs === session.lastSeenMs &&
        previous.cwd === session.cwd
      )
        continue;
      this.#sessions.set(session.id, session);
      changes.push({ kind: "upsert", session });
    }
    return changes;
  }

  /** Nobody has heard from these in too long. A worker that types forever is the lie to avoid. */
  reap(): readonly RegistryChange[] {
    const now = this.#now();
    const changes: RegistryChange[] = [];
    for (const [id, session] of this.#sessions) {
      if (now - session.lastSeenMs <= this.#departAfterMs) continue;
      this.#sessions.delete(id);
      changes.push({ id, kind: "gone" });
    }
    return changes;
  }
}

function projectOf(cwd: string): string {
  const parts = cwd.split("/").filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? "unknown";
}
