/**
 * A bridge with a script instead of a machine behind it.
 *
 * The live bridge is the point of this game, and it is also the worst possible thing to gate a
 * build on: what it reports depends on how many agents happen to be running. This serves the same
 * protocol from a fixed sequence, so the office's arrival, departure and blocked paths can be
 * proved the same way twice.
 *
 * The script plays out in well under two seconds and the office counts what it saw, so the proof
 * asserts monotonic counters rather than racing a wall clock against a tick budget.
 */
import { WebSocketServer } from "ws";
import type { ISessionSummary, OfficeMessage } from "./protocol.js";

const PORT = Number.parseInt(process.env.OFFICE_FIXTURE_PORT ?? "7374", 10);
/**
 * The script advances on the office's own viewer heartbeat, not on a clock.
 *
 * A playtest drives ticks as fast as the machine will go — a scenario that reads as fifteen
 * seconds of waiting is over in about one and a half — so a wall-clock script either fires before
 * the first sample or after the last. Heartbeats are the one unit the game and the proof share.
 */
const HEARTBEATS_PER_STEP = 3;

function session(
  id: string,
  host: "claude" | "codex",
  project: string,
  state: ISessionSummary["state"],
  startedMs: number,
): ISessionSummary {
  return {
    cwd: `/home/agent/${project}`,
    host,
    id,
    lastSeenMs: startedMs,
    project,
    source: "process",
    startedMs,
    state,
  };
}

const opened: readonly ISessionSummary[] = [
  session("codex:101", "codex", "threenative-engine", "working", 1_000),
  session("codex:102", "codex", "rpg-api", "thinking", 2_000),
  session("claude:103", "claude", "threenative-engine", "working", 3_000),
];

const script: readonly OfficeMessage[] = [
  // One session stands up and takes a call: the state a human is meant to notice from the door.
  { kind: "delta", session: { ...(opened[1] as ISessionSummary), state: "blocked" } },
  // One ends and its desk frees.
  { id: "codex:101", kind: "gone" },
  // A fourth walks in and takes the free desk.
  { kind: "delta", session: session("claude:104", "claude", "linchpin", "working", 4_000) },
];

const sockets = new WebSocketServer({ host: "127.0.0.1", port: PORT });
sockets.on("connection", (client) => {
  client.send(JSON.stringify({ kind: "snapshot", serverStartedMs: 0, sessions: opened }));
  let beats = 0;
  let delivered = 0;
  client.on("message", (raw) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(raw));
    } catch {
      return;
    }
    if ((parsed as { kind?: unknown }).kind !== "viewer") return;
    beats += 1;
    const wanted = Math.floor(beats / HEARTBEATS_PER_STEP);
    while (delivered < Math.min(wanted, script.length)) {
      client.send(JSON.stringify(script[delivered] as OfficeMessage));
      delivered += 1;
    }
  });
});
sockets.on("listening", () => {
  process.stderr.write(`[fixture] office fixture on ws://127.0.0.1:${String(PORT)}/office\n`);
});
