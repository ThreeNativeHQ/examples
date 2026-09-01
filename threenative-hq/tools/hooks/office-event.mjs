#!/usr/bin/env node
/**
 * Tell the office what this session just did.
 *
 * Installed as a hook in Claude Code and Codex. It reads the host's hook payload on stdin, posts
 * one small event to the local bridge, and gets out of the way: **it always exits 0 and never
 * prints to stdout**, because a hook that fails loudly, blocks, or writes to the transcript would
 * make watching your agents a reason for your agents to break.
 *
 * Nothing about the prompt or the tool's arguments is sent — only which session, where it is
 * working, and which of six things just happened.
 */
import { argv, env, exit, stdin } from "node:process";

const TIMEOUT_MS = 250;
const URL = env.TN_OFFICE_URL ?? "http://127.0.0.1:7373/event";

/** Host event name -> what the office calls it. Anything not here is not worth a desk update. */
const KINDS = new Map([
  ["SessionStart", "start"],
  ["UserPromptSubmit", "prompt"],
  ["PreToolUse", "tool"],
  ["PostToolUse", "tool"],
  ["Notification", "notify"],
  ["Stop", "stop"],
  ["SessionEnd", "end"],
  // Codex spells its events in snake case.
  ["session_start", "start"],
  ["user_prompt_submit", "prompt"],
  ["pre_tool_use", "tool"],
  ["post_tool_use", "tool"],
  ["permission_request", "notify"],
  ["stop", "stop"],
  ["session_end", "end"],
]);

function flag(name, fallback) {
  const index = argv.indexOf(name);
  const value = index === -1 ? undefined : argv[index + 1];
  return value === undefined || value.startsWith("--") ? fallback : value;
}

async function main() {
  let raw = "";
  for await (const chunk of stdin) {
    raw += chunk;
    if (raw.length > 1_000_000) break;
  }
  let payload = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = {};
  }
  const host = flag("--host", "claude");
  const eventName = flag("--event", payload.hook_event_name ?? payload.event ?? "");
  const kind = KINDS.get(eventName);
  if (kind === undefined) return;
  const body = {
    host,
    kind,
    sessionId: String(payload.session_id ?? payload.sessionId ?? env.CLAUDE_SESSION_ID ?? "unknown"),
    ...(payload.cwd === undefined ? {} : { cwd: String(payload.cwd) }),
    ...(payload.tool_name === undefined ? {} : { tool: String(payload.tool_name) }),
    ...(payload.model === undefined ? {} : { model: String(payload.model) }),
  };
  await fetch(URL, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

try {
  await main();
} catch {
  // The office being down is not this session's problem.
}
exit(0);
