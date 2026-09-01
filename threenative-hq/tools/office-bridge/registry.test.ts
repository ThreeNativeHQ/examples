import assert from "node:assert/strict";
import { OfficeRegistry } from "./registry.js";
import type { IProcessSession } from "./processes.js";

let now = 1_000;
const registry = new OfficeRegistry({ busyCpuMs: 40, now: () => now });
const process = (cpuMs: number): IProcessSession => ({
  cpuMs,
  cwd: "/work/project",
  host: "codex",
  id: "codex:123",
  model: undefined,
  pid: 123,
  project: "project",
  startedMs: 0,
});

registry.applyProcesses([process(100)]);
now += 2_000;
registry.applyProcesses([process(200)]);
assert.equal(registry.snapshot().sessions[0]?.state, "working", "CPU activity starts work");

now += 2_000;
registry.applyProcesses([process(200)]);
assert.equal(
  registry.snapshot().sessions[0]?.state,
  "working",
  "one quiet scan must not stop a worker whose remote request is still running",
);

now += 31_000;
registry.applyProcesses([process(200)]);
assert.equal(registry.snapshot().sessions[0]?.state, "idle", "sustained quiet becomes idle");

console.log("registry CPU-state hysteresis: ok");
