/**
 * A bridge that drives every sit/stand seam the office has, on purpose.
 *
 * `fixture.ts` proves arrivals, departures and the blocked state, and it is the right shape for
 * that: three sessions, three deltas, over in a second and a half. What it never produces is a
 * session that moves between two *seated* states — so `SitToType` and `TypeToSit`, the two Mixamo
 * chair<->keyboard one-shots, never run under any committed proof. A transition nothing exercises
 * is a transition nobody notices breaking.
 *
 * This serves the same protocol from a longer script whose only job is to make all four one-shots
 * fire, twice where it can, with enough quiet between them for `Worker.settled` to become true and
 * for the resulting loop to be measured:
 *
 *   arriving -> idle       Sitting_Enter   (stand -> chair)
 *   idle     -> working    SitToType       (chair -> keyboard)
 *   working  -> thinking   TypeToSit       (keyboard -> chair)
 *   thinking -> working    SitToType
 *   working  -> idle       TypeToSit
 *   working  -> blocked    Sitting_Exit    (chair -> standing)
 *   blocked  -> working    Sitting_Enter
 *
 * Like `fixture.ts`, the script advances on the office's own viewer heartbeat rather than on a
 * clock: a playtest drives ticks as fast as the machine will go, and a capture host renders the
 * same world at a sixth of real time, so wall-clock timing is the one thing the two ends do not
 * share. `OFFICE_FIXTURE_PORT` and `OFFICE_FIXTURE_BEATS` override the defaults.
 */
import { WebSocketServer } from "ws";
import type { ISessionSummary, OfficeMessage, SessionState } from "./protocol.js";

const PORT = Number.parseInt(process.env.OFFICE_FIXTURE_PORT ?? "7375", 10);
/**
 * Heartbeats between script steps.
 *
 * The office beats every 20 frames, so six beats is 120 frames — two seconds of game time at the
 * fixed 1/60 s step. That is comfortably longer than the 1.3 s of the longest one-shot plus the
 * 0.6 s `Worker.settled` needs afterwards, so every step is observed both mid-transition and
 * settled.
 */
const HEARTBEATS_PER_STEP = Number.parseInt(process.env.OFFICE_FIXTURE_BEATS ?? "6", 10);

function session(
  id: string,
  host: "claude" | "codex",
  project: string,
  state: SessionState,
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
    tool: "Read",
  };
}

/** The typist cycles between seated states; the stander is the one that leaves its chair. */
const TYPIST = session("claude:201", "claude", "typist-lane", "idle", 1_000);
const STANDER = session("codex:202", "codex", "stander-lane", "working", 2_000);

const opened: readonly ISessionSummary[] = [TYPIST, STANDER];

const at = (base: ISessionSummary, state: SessionState): OfficeMessage => ({
  kind: "delta",
  session: { ...base, state },
});

const script: readonly OfficeMessage[] = [
  at(TYPIST, "working"), // SitToType
  at(TYPIST, "thinking"), // TypeToSit
  at(TYPIST, "working"), // SitToType, again
  at(TYPIST, "idle"), // TypeToSit, again
  at(STANDER, "blocked"), // Sitting_Exit
  at(STANDER, "working"), // Sitting_Enter
  at(TYPIST, "working"), // SitToType, and the office settles here
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
      const message = script[delivered] as OfficeMessage;
      client.send(JSON.stringify(message));
      process.stderr.write(
        `[poses] beat ${String(beats)} -> ${message.kind === "delta" ? `${message.session.id}=${message.session.state}` : message.kind}\n`,
      );
      delivered += 1;
    }
  });
});
sockets.on("listening", () => {
  process.stderr.write(`[poses] pose fixture on ws://127.0.0.1:${String(PORT)}/office\n`);
});
