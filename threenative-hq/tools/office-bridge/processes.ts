/**
 * Who is actually running, from the process table.
 *
 * The first version of this file trusted transcript modification times, and on the machine it was
 * written for that produced 606 live sessions: something had touched 4,413 transcripts — May's
 * included — inside one minute. A file's mtime says when something wrote to it, not that an agent
 * is sitting there working, and a floor full of workers for sessions that ended in May is exactly
 * the kind of confident wrongness this office exists to avoid.
 *
 * So liveness comes from the kernel: a live session is a live process. `/proc/<pid>/cwd` gives the
 * repository it is working in, its command line gives the model when one was named, and the CPU
 * time it has burned between two scans says whether it is doing anything — a generating or
 * tool-running agent burns CPU, one waiting for its human does not.
 */
import { readFile, readdir, readlink } from "node:fs/promises";
import { basename } from "node:path";
import type { SessionHost } from "./protocol.js";

export interface IProcessSession {
  readonly id: string;
  readonly pid: number;
  readonly host: SessionHost;
  readonly cwd: string;
  readonly project: string;
  readonly startedMs: number;
  /** Total CPU milliseconds this process has used, for the busy/idle comparison. */
  readonly cpuMs: number;
  readonly model: string | undefined;
}

const CLOCK_TICKS_PER_SECOND = 100;

/** Command lines that are an agent session rather than one of its children. */
function hostOf(command: readonly string[]): SessionHost | undefined {
  const [executable, ...rest] = command;
  if (executable === undefined) return undefined;
  const name = basename(executable);
  // `claude` is the CLI itself. Node running the CLI's entry script counts too, which is how it
  // appears under nvm.
  if (name === "claude") return "claude";
  if (name === "codex") return "codex";
  if (name === "node" || name === "nodejs") {
    const script = rest.find((argument) => !argument.startsWith("-"));
    if (script === undefined) return undefined;
    const scriptName = basename(script);
    if (scriptName === "claude") return "claude";
    if (scriptName === "codex") return "codex";
  }
  return undefined;
}

function modelOf(command: readonly string[]): string | undefined {
  const index = command.indexOf("--model");
  const value = index === -1 ? undefined : command[index + 1];
  return value === undefined || value.startsWith("-") ? undefined : value;
}

export interface IProcessScanOptions {
  /** Overridable so a test can point at a fixture tree instead of the real `/proc`. */
  readonly procRoot?: string;
  readonly bootMs?: number;
}

/** Every agent session running right now. Empty on a host without a Linux-shaped `/proc`. */
export async function scanProcesses(options: IProcessScanOptions = {}): Promise<IProcessSession[]> {
  const root = options.procRoot ?? "/proc";
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }
  const bootMs = options.bootMs ?? (await bootTimeMs(root));
  const sessions: IProcessSession[] = [];
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number.parseInt(entry, 10);
    let command: string[];
    try {
      const raw = await readFile(`${root}/${entry}/cmdline`, "utf8");
      command = raw.split("\0").filter((part) => part.length > 0);
    } catch {
      continue;
    }
    const host = hostOf(command);
    if (host === undefined) continue;
    let cwd: string;
    try {
      cwd = await readlink(`${root}/${entry}/cwd`);
    } catch {
      // A session owned by another user, or one that exited between the listing and this read.
      continue;
    }
    const stats = await processStats(root, entry);
    if (stats === undefined) continue;
    sessions.push({
      cpuMs: stats.cpuMs,
      cwd,
      host,
      id: `${host}:${String(pid)}`,
      model: modelOf(command),
      pid,
      project: basename(cwd) || "unknown",
      startedMs: bootMs + stats.startTicks * (1000 / CLOCK_TICKS_PER_SECOND),
    });
  }
  return sessions.sort((a, b) => a.startedMs - b.startedMs || a.pid - b.pid);
}

async function processStats(
  root: string,
  entry: string,
): Promise<{ cpuMs: number; startTicks: number } | undefined> {
  let raw: string;
  try {
    raw = await readFile(`${root}/${entry}/stat`, "utf8");
  } catch {
    return undefined;
  }
  // The second field is the executable name in parentheses and may itself contain spaces, so the
  // fields after it are counted from the last ')' rather than from a naive split.
  const close = raw.lastIndexOf(")");
  if (close === -1) return undefined;
  const fields = raw.slice(close + 2).split(" ");
  const utime = Number.parseInt(fields[11] ?? "", 10);
  const stime = Number.parseInt(fields[12] ?? "", 10);
  const startTicks = Number.parseInt(fields[19] ?? "", 10);
  if (!Number.isFinite(utime) || !Number.isFinite(stime) || !Number.isFinite(startTicks))
    return undefined;
  return {
    cpuMs: ((utime + stime) * 1000) / CLOCK_TICKS_PER_SECOND,
    startTicks,
  };
}

async function bootTimeMs(root: string): Promise<number> {
  try {
    const raw = await readFile(`${root}/stat`, "utf8");
    const line = raw.split("\n").find((entry) => entry.startsWith("btime "));
    const seconds = line === undefined ? Number.NaN : Number.parseInt(line.slice(6), 10);
    if (Number.isFinite(seconds)) return seconds * 1000;
  } catch {
    // Fall through to "unknown boot time": start times become relative, which only affects desk
    // ordering, never whether a session is on the floor.
  }
  return 0;
}
