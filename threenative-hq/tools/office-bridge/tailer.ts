/**
 * Finding the sessions that never installed a hook.
 *
 * Every Claude Code and Codex session writes a JSONL transcript as it goes, so the floor can be
 * populated without either host cooperating — which matters because the hooks land later and
 * because a session already running when the bridge starts has no start event to replay.
 *
 * This lane is deliberately coarse. It can tell that a session exists, where it is working and
 * whether it moved recently; it cannot tell that a session is blocked on a permission prompt.
 * The hook lane is what makes that distinction, and the summary says which lane it came from.
 */
import { readdir, open, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { ISessionSummary, SessionHost, SessionState } from "./protocol.js";

/** How much of a transcript's tail is read to decide what the session is doing. */
const TAIL_BYTES = 64 * 1024;

export interface ITailerOptions {
  /** Overridable so a test can point at a fixture tree instead of the real home directory. */
  readonly claudeRoot?: string;
  readonly codexRoot?: string;
  /** A transcript untouched for longer than this is not a live session. */
  readonly staleMs?: number;
  /** Quiet for longer than this, but not stale, reads as an idle session. */
  readonly idleMs?: number;
  readonly now?: () => number;
}

export interface ITailerReport {
  readonly sessions: readonly ISessionSummary[];
  /** Lines that could not be parsed, counted rather than guessed at. */
  readonly malformedLines: number;
  readonly filesScanned: number;
}

export class SessionTailer {
  readonly #claudeRoot: string;
  readonly #codexRoot: string;
  readonly #staleMs: number;
  readonly #idleMs: number;
  readonly #now: () => number;

  constructor(options: ITailerOptions = {}) {
    this.#claudeRoot = options.claudeRoot ?? join(homedir(), ".claude", "projects");
    this.#codexRoot = options.codexRoot ?? join(homedir(), ".codex", "sessions");
    this.#staleMs = options.staleMs ?? 15 * 60 * 1000;
    this.#idleMs = options.idleMs ?? 90 * 1000;
    this.#now = options.now ?? (() => Date.now());
  }

  async scan(): Promise<ITailerReport> {
    const now = this.#now();
    const files = [
      ...(await transcripts(this.#claudeRoot)).map((path) => ({ host: "claude" as const, path })),
      ...(await transcripts(this.#codexRoot)).map((path) => ({ host: "codex" as const, path })),
    ];
    const sessions: ISessionSummary[] = [];
    let malformedLines = 0;
    for (const file of files) {
      let modifiedMs: number;
      let createdMs: number;
      try {
        const stats = await stat(file.path);
        modifiedMs = stats.mtimeMs;
        createdMs = stats.birthtimeMs === 0 ? stats.mtimeMs : stats.birthtimeMs;
      } catch {
        continue;
      }
      if (now - modifiedMs > this.#staleMs) continue;
      const read = await readTail(file.path);
      malformedLines += read.malformed;
      const id = sessionId(file.host, file.path, read.records);
      if (id === undefined) continue;
      sessions.push({
        cwd: read.cwd ?? cwdFromPath(file.host, file.path),
        host: file.host,
        id,
        lastSeenMs: modifiedMs,
        project: basename(read.cwd ?? cwdFromPath(file.host, file.path)) || "unknown",
        source: "transcript",
        startedMs: createdMs,
        state: transcriptState(now, modifiedMs, this.#idleMs, read.lastKind),
        ...(read.model === undefined ? {} : { model: read.model }),
      });
    }
    return { filesScanned: files.length, malformedLines, sessions };
  }
}

/**
 * Coarse on purpose.
 *
 * A transcript that grew a second ago is a session doing something; one quiet for a minute and a
 * half is a session waiting for its human. "Blocked" is never claimed here — the file looks the
 * same whether a session is waiting on a permission prompt or on a person to come back from lunch,
 * and guessing between those is exactly the kind of confident wrongness this office must not add.
 */
function transcriptState(
  now: number,
  modifiedMs: number,
  idleMs: number,
  lastKind: string | undefined,
): SessionState {
  if (now - modifiedMs > idleMs) return "idle";
  if (lastKind === "tool") return "working";
  return "thinking";
}

async function transcripts(root: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > 6) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path, depth + 1);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) found.push(path);
    }
  };
  await walk(root, 0);
  return found;
}

interface ITailRead {
  readonly records: readonly Record<string, unknown>[];
  readonly malformed: number;
  readonly cwd: string | undefined;
  readonly model: string | undefined;
  readonly lastKind: string | undefined;
}

/**
 * Read the end of a transcript.
 *
 * The first line is dropped whenever the file is longer than the window: a transcript is appended
 * to while this runs, and half a JSON object parsed optimistically is a made-up record.
 */
async function readTail(path: string): Promise<ITailRead> {
  let handle;
  try {
    handle = await open(path, "r");
  } catch {
    return { cwd: undefined, lastKind: undefined, malformed: 0, model: undefined, records: [] };
  }
  try {
    const stats = await handle.stat();
    const start = Math.max(0, stats.size - TAIL_BYTES);
    const length = stats.size - start;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    const lines = buffer.toString("utf8").split("\n");
    if (start > 0) lines.shift();
    const records: Record<string, unknown>[] = [];
    let malformed = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed))
          records.push(parsed as Record<string, unknown>);
        else malformed += 1;
      } catch {
        // The final line of a live transcript is routinely half-written. Count it; never repair it.
        malformed += 1;
      }
    }
    return {
      cwd: readCwd(records),
      lastKind: readLastKind(records),
      malformed,
      model: readModel(records),
      records,
    };
  } finally {
    await handle.close();
  }
}

function readCwd(records: readonly Record<string, unknown>[]): string | undefined {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index] as Record<string, unknown>;
    const direct = record.cwd;
    if (typeof direct === "string" && direct.length > 0) return direct;
    const payload = record.payload as Record<string, unknown> | undefined;
    if (payload !== undefined && typeof payload.cwd === "string" && payload.cwd.length > 0)
      return payload.cwd;
  }
  return undefined;
}

function readModel(records: readonly Record<string, unknown>[]): string | undefined {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index] as Record<string, unknown>;
    const message = record.message as Record<string, unknown> | undefined;
    if (message !== undefined && typeof message.model === "string") return message.model;
    const payload = record.payload as Record<string, unknown> | undefined;
    if (payload !== undefined && typeof payload.model === "string") return payload.model;
  }
  return undefined;
}

/** "tool" when the newest interesting record is a tool call, otherwise whatever it was. */
function readLastKind(records: readonly Record<string, unknown>[]): string | undefined {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index] as Record<string, unknown>;
    const type = typeof record.type === "string" ? record.type : undefined;
    if (type === undefined) continue;
    const serialized = JSON.stringify(record);
    if (serialized.includes('"tool_use"') || serialized.includes('"function_call"')) return "tool";
    if (type === "assistant" || type === "user" || type === "response_item") return type;
  }
  return undefined;
}

/**
 * The session's own id.
 *
 * Claude Code names the transcript file after the session and repeats the id inside; Codex writes
 * a `session_meta` record. The filename is the fallback because a session whose id we cannot read
 * still deserves a desk, and a stable key is all the office needs.
 */
function sessionId(
  host: SessionHost,
  path: string,
  records: readonly Record<string, unknown>[],
): string | undefined {
  for (const record of records) {
    const direct = record.sessionId;
    if (typeof direct === "string" && direct.length > 0) return `${host}:${direct}`;
    const payload = record.payload as Record<string, unknown> | undefined;
    const nested = payload?.session_id;
    if (typeof nested === "string" && nested.length > 0) return `${host}:${nested}`;
  }
  const name = basename(path, ".jsonl");
  return name.length === 0 ? undefined : `${host}:${name}`;
}

/** Claude Code slugs the working directory into the transcript's parent folder name. */
function cwdFromPath(host: SessionHost, path: string): string {
  if (host !== "claude") return "unknown";
  const slug = basename(dirname(path));
  return slug.startsWith("-") ? slug.replaceAll("-", "/") : slug;
}
