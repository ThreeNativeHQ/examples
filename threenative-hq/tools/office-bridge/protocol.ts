/**
 * The wire between the office and the machine it is watching.
 *
 * Imported by the daemon and by the game, so the two cannot drift: a field renamed on one side
 * stops compiling on the other. Everything here validates rather than casts — the daemon reads
 * files written by other programs, and a shape it merely hoped for is how a worker ends up typing
 * on behalf of a session that ended an hour ago.
 */
export type SessionHost = "claude" | "codex";

/** What a session is doing. The office maps these to poses in `src/office/states.ts`. */
export type SessionState = "arriving" | "working" | "thinking" | "blocked" | "idle" | "leaving";

export const SESSION_STATES: readonly SessionState[] = [
  "arriving",
  "working",
  "thinking",
  "blocked",
  "idle",
  "leaving",
];

/** The kinds of thing a host hook can tell the bridge. Anything else is rejected. */
export const EVENT_KINDS = ["start", "prompt", "tool", "notify", "stop", "end"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export interface ISessionEvent {
  readonly sessionId: string;
  readonly host: SessionHost;
  readonly kind: EventKind;
  readonly cwd?: string;
  readonly tool?: string;
  readonly model?: string;
}

export interface ISessionSummary {
  readonly id: string;
  readonly host: SessionHost;
  /** Absolute working directory the session was launched in. */
  readonly cwd: string;
  /** Last path segment of `cwd`, which is what a worker card shows. */
  readonly project: string;
  readonly state: SessionState;
  /** Epoch milliseconds of the last signal of any kind. */
  readonly lastSeenMs: number;
  readonly startedMs: number;
  /** How the bridge learned about this session, so a report can say which lane proved it. */
  readonly source: "hook" | "process" | "transcript";
  readonly tool?: string;
  readonly model?: string;
}

export interface IOfficeSnapshot {
  readonly kind: "snapshot";
  readonly sessions: readonly ISessionSummary[];
  readonly serverStartedMs: number;
}

export interface IOfficeDelta {
  readonly kind: "delta";
  readonly session: ISessionSummary;
}

export interface IOfficeDeparture {
  readonly kind: "gone";
  readonly id: string;
}

export type OfficeMessage = IOfficeSnapshot | IOfficeDelta | IOfficeDeparture;

/** The longest an event may be. A hook posting more than this is malfunctioning, not verbose. */
export const MAX_EVENT_BYTES = 16 * 1024;

export class ProtocolError extends Error {}

function requireString(value: unknown, field: string, max = 4096): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max)
    throw new ProtocolError(`"${field}" must be a string of 1..${String(max)} characters.`);
  return value;
}

function optionalString(value: unknown, field: string, max = 4096): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requireString(value, field, max);
}

/** Validate one posted event. Fails closed: unknown kind, unknown host, missing id are refusals. */
export function parseSessionEvent(raw: unknown): ISessionEvent {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    throw new ProtocolError("An event must be a JSON object.");
  const record = raw as Record<string, unknown>;
  const host = requireString(record.host, "host", 16);
  if (host !== "claude" && host !== "codex")
    throw new ProtocolError(`"host" must be "claude" or "codex", got "${host}".`);
  const kind = requireString(record.kind, "kind", 16);
  if (!(EVENT_KINDS as readonly string[]).includes(kind))
    throw new ProtocolError(`"kind" must be one of ${EVENT_KINDS.join(", ")}, got "${kind}".`);
  const cwd = optionalString(record.cwd, "cwd");
  const tool = optionalString(record.tool, "tool", 200);
  const model = optionalString(record.model, "model", 200);
  return {
    host,
    kind: kind as EventKind,
    sessionId: requireString(record.sessionId, "sessionId", 200),
    ...(cwd === undefined ? {} : { cwd }),
    ...(tool === undefined ? {} : { tool }),
    ...(model === undefined ? {} : { model }),
  };
}

/** The state an event implies, before the idle timer gets a say. */
export function stateForEvent(kind: EventKind): SessionState {
  switch (kind) {
    case "start":
      return "arriving";
    case "prompt":
      return "thinking";
    case "tool":
      return "working";
    case "notify":
      return "blocked";
    case "stop":
      return "idle";
    case "end":
      return "leaving";
  }
}
