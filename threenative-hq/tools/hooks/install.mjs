#!/usr/bin/env node
/**
 * Add the office's hooks to a host's settings without disturbing what is already there.
 *
 * Prints the exact change and, unless `--write` is passed, changes nothing. Somebody's global
 * agent configuration is not a place to be helpful by default: this machine's `~/.claude/settings.json`
 * already carries a `Stop` hook that counts tokens, and an installer that "just sets" the hooks
 * block would have deleted it.
 */
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { argv, cwd, stderr, stdout } from "node:process";

const script = join(cwd(), "tools", "hooks", "office-event.mjs");
const EVENTS = ["SessionStart", "UserPromptSubmit", "PreToolUse", "Notification", "Stop", "SessionEnd"];

function entryFor(host, event) {
  return { hooks: [{ command: `node ${script} --host ${host} --event ${event}`, type: "command" }] };
}

function isOurs(entry) {
  return JSON.stringify(entry).includes("office-event.mjs");
}

/** Merge into whatever is there. Existing hooks are preserved; ours are replaced, never doubled. */
function merge(config, host) {
  const next = { ...config };
  const hooks = { ...(next.hooks ?? {}) };
  for (const event of EVENTS) {
    const existing = Array.isArray(hooks[event]) ? hooks[event] : [];
    hooks[event] = [...existing.filter((entry) => !isOurs(entry)), entryFor(host, event)];
  }
  next.hooks = hooks;
  return next;
}

async function apply(path, host, write) {
  let current = {};
  try {
    current = JSON.parse(await readFile(path, "utf8"));
  } catch {
    current = {};
  }
  const next = merge(current, host);
  const before = JSON.stringify(current.hooks ?? {}, null, 2);
  const after = JSON.stringify(next.hooks, null, 2);
  if (before === after) {
    stderr.write(`${path}: already installed\n`);
    return;
  }
  stdout.write(`\n== ${path} ==\nhooks before:\n${before}\n\nhooks after:\n${after}\n`);
  if (!write) return;
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  stderr.write(`${path}: written\n`);
}

const write = argv.includes("--write");
const home = argv.includes("--home") ? argv[argv.indexOf("--home") + 1] : homedir();
await apply(join(home, ".claude", "settings.json"), "claude", write);
await apply(join(home, ".codex", "hooks.json"), "codex", write);
if (!write) stderr.write("\nDry run. Re-run with --write to apply.\n");
