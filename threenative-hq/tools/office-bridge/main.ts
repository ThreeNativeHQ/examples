/**
 * `pnpm office` — the daemon the game connects to.
 *
 * It watches this machine's agent transcripts, accepts events from host hooks, and serves both
 * over one loopback port. It never starts, stops, or writes to a session.
 */
import { scanProcesses } from "./processes.js";
import { OfficeRegistry } from "./registry.js";
import { startOfficeServer } from "./server.js";
import { SessionTailer } from "./tailer.js";

const DEFAULT_PORT = 7373;
const SCAN_INTERVAL_MS = 2_000;

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${name}.`);
  return value;
}

const portFlag = flag("--port");
const port = portFlag === undefined ? DEFAULT_PORT : Number.parseInt(portFlag, 10);
if (!Number.isInteger(port) || port < 1 || port > 65_535)
  throw new Error(`--port must be a TCP port, got "${String(portFlag)}".`);

const registry = new OfficeRegistry();
// `--no-transcript-fallback` makes a machine without a readable process table report an empty
// office instead of guessing from file timestamps.
const fallbackAllowed = !process.argv.includes("--no-transcript-fallback");
const tailer = new SessionTailer({
  ...(flag("--claude-root") === undefined ? {} : { claudeRoot: flag("--claude-root") as string }),
  ...(flag("--codex-root") === undefined ? {} : { codexRoot: flag("--codex-root") as string }),
});
const log = (message: string): void => {
  process.stderr.write(`[office] ${message}\n`);
};
const server = await startOfficeServer({ log, port, registry });

let scanning = false;
let warnedAboutFallback = false;
const scan = async (): Promise<void> => {
  if (scanning) return;
  scanning = true;
  try {
    const processes = await scanProcesses();
    if (processes.length > 0 || !fallbackAllowed) {
      server.broadcast(registry.applyProcesses(processes));
    } else {
      // No `/proc` to read, so fall back to transcripts and say so. This lane cannot tell a
      // blocked session from a thinking one, and on a machine whose transcript timestamps get
      // rewritten in bulk it cannot tell live from long-finished either.
      if (!warnedAboutFallback) {
        log("no agent processes visible; falling back to transcript discovery");
        warnedAboutFallback = true;
      }
      const report = await tailer.scan();
      server.broadcast(registry.applyTranscripts(report.sessions));
      server.broadcast(registry.reap());
    }
  } catch (error) {
    log(`scan failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    scanning = false;
  }
};
await scan();
log(`first scan found ${String(registry.size)} live sessions`);
const timer = setInterval(() => void scan(), SCAN_INTERVAL_MS);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    clearInterval(timer);
    void server.close().then(() => process.exit(0));
  });
}
