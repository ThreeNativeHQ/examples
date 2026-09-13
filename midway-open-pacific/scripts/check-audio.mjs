/**
 * Soundscape lifecycle check. Runs the real src/audio.ts against a stub WebAudio graph, so the
 * things that only break at runtime — a duplicated loop, a sample that never replaces the
 * oscillator, a held trigger stacking voices, a dispose that leaves the context open — fail here.
 *
 * Uses the esbuild already installed by vite; no dependency is added. Run: node scripts/check-audio.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { transform } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let ctxCount = 0;
let created = [];
/** sources currently sounding; a real context retires them and that is what frees a voice slot. */
let live = new Set();
let peakLive = 0;

/**
 * Move the stub clock, firing onended for every one-shot whose buffer has run out. Without this
 * the voice caps never free up and every cap assertion passes for the wrong reason.
 */
function advance(ctx, seconds) {
  ctx.currentTime += seconds;
  for (const n of [...live]) {
    if (n.loop || n.startedAt === null) continue;
    // An oscillator ends only at its scheduled stop; a buffer source also ends at buffer end.
    const ends = Math.min(n.stopAt ?? Infinity, n.buffer ? n.startedAt + n.buffer.duration : Infinity);
    if (ctx.currentTime >= ends) {
      n.stopped = true;
      live.delete(n);
      n.onended?.();
    }
  }
}

/** Gives a source node the start/stop semantics the Soundscape relies on. */
function voice(n, ctx) {
  n.startedAt = null;
  n.stopAt = null;
  n.start = (t = ctx.currentTime) => {
    n.started = true;
    n.startedAt = t;
    live.add(n);
    // Only sampled one-shots; the two synthetic engine oscillators are not under a voice cap.
    peakLive = Math.max(peakLive, [...live].filter((x) => !x.loop && x.buffer).length);
  };
  n.stop = (when) => {
    if (when !== undefined && when > ctx.currentTime) {
      n.stopAt = when; // scheduled; advance() retires it and fires onended
      return;
    }
    n.stopped = true;
    live.delete(n);
  };
  return n;
}

class Param {
  constructor(v = 0) {
    this.value = v;
  }
  setValueAtTime(v) {
    this.value = v;
    return this;
  }
  setTargetAtTime(v) {
    this.value = v;
    return this;
  }
  exponentialRampToValueAtTime(v) {
    this.value = v;
    return this;
  }
}

class Node {
  constructor(kind) {
    this.kind = kind;
    this.connected = 0;
    this.stopped = false;
    this.started = false;
    created.push(this);
  }
  connect() {
    this.connected += 1;
    return this;
  }
  disconnect() {
    this.connected -= 1;
  }
  start() {
    this.started = true;
  }
  stop() {
    this.stopped = true;
  }
}

class StubCtx {
  constructor() {
    ctxCount += 1;
    this.state = "suspended";
    this.currentTime = 0;
    this.sampleRate = 48000;
    this.destination = new Node("destination");
    this.closed = false;
    this.decoded = 0;
  }
  resume() {
    this.state = "running";
    return Promise.resolve();
  }
  close() {
    this.closed = true;
    return Promise.resolve();
  }
  createGain() {
    const n = new Node("gain");
    n.gain = new Param(1);
    return n;
  }
  createOscillator() {
    const n = new Node("osc");
    n.frequency = new Param(0);
    return voice(n, this);
  }
  createBiquadFilter() {
    const n = new Node("filter");
    n.frequency = new Param(0);
    return n;
  }
  createBufferSource() {
    const n = new Node("source");
    n.playbackRate = new Param(1);
    n.buffer = null;
    n.loop = false;
    return voice(n, this);
  }
  createBuffer(_ch, len) {
    return { length: len, getChannelData: () => new Float32Array(len) };
  }
  decodeAudioData() {
    this.decoded += 1;
    return Promise.resolve({ duration: 1, sampleRate: 48000 });
  }
}

/** Every file audio.ts asks for must exist on disk; a typo'd name is a silent fallback in the game. */
const shipped = new Set(readdirSync(resolve(root, "public/assets/audio")));
let requested = [];
let failNext = new Set();

function install() {
  ctxCount = 0;
  created = [];
  requested = [];
  live = new Set();
  peakLive = 0;
  globalThis.window = { AudioContext: StubCtx };
  globalThis.fetch = async (url) => {
    const file = String(url).split("/").pop();
    requested.push(file);
    if (failNext.has(file)) return { ok: false, status: 404 };
    assert.ok(shipped.has(file), `audio.ts requests ${file}, which is not in public/assets/audio`);
    return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) };
  };
}

const src = readFileSync(resolve(root, "src/audio.ts"), "utf8");
// import.meta.env is Vite's; the stub only needs the base path to resolve.
const js = (await transform(src, { loader: "ts", format: "esm", target: "node20" })).code.replace(
  /\(import\.meta\)\.env\?\.BASE_URL/g,
  '"/"',
);
const { Soundscape } = await import(`data:text/javascript,${encodeURIComponent(js)}`);

const settle = () => new Promise((r) => setTimeout(r, 0));
const loops = () => created.filter((n) => n.kind === "source" && n.loop && n.started && !n.stopped);
const player = { rpm: 0.8, throttle: 0.8, ias: 120, stall: 0 };

// 1 — start() under a gesture creates one context, resumes it, and never builds a second graph.
install();
let s = new Soundscape();
s.start();
s.start();
s.start();
assert.equal(ctxCount, 1, "start() built more than one AudioContext");
assert.equal(s.ctx.state, "running", "start() left a suspended context suspended");
assert.ok(s.engine?.started, "no synthetic engine while the samples are still loading");

// 2 — the samples replace the oscillator, and loops are started exactly once.
await settle();
await settle();
assert.equal(new Set(requested).size, requested.length, "a sample was fetched twice");
assert.equal(s.engine, null, "the sawtooth drone survived the real engine loop");
assert.equal(loops().length, 2, `expected engine + wind loops, got ${loops().length}`);
s.start(); // a later gesture must not add a second engine loop
await settle();
assert.equal(loops().length, 2, "a repeat start() duplicated the sample loops");

// 3a — the cooldown gates a trigger held down inside one cooldown window.
let before = created.length;
for (let i = 0; i < 40; i += 1) s.event({ type: "gun" });
assert.equal(
  created.slice(before).filter((n) => n.kind === "source").length,
  1,
  "40 gun events inside one 0.05 s cooldown opened more than one voice",
);

// 3b — past the cooldown the voice cap takes over. The clock must advance, and finished voices
// must be retired, or the cooldown alone satisfies this and the cap is never exercised.
const spaced = created.length;
peakLive = 0;
for (let i = 0; i < 40; i += 1) {
  advance(s.ctx, 0.06); // just past the 0.05 s gun cooldown, so the cap is what bites
  s.event({ type: "gun" });
}
const guns = created.slice(before).filter((n) => n.kind === "source");
assert.ok(created.length > spaced, "spaced gun events never reached the buffer path");
assert.ok(guns.length > 4, `only ${guns.length} voices over 40 spaced events; they never recycled`);
assert.equal(peakLive, 4, `40 spaced gun events reached ${peakLive} simultaneous voices; the cap is 4`);
assert.ok(
  created.slice(before).every((n) => n.kind !== "filter"),
  "gun fell back to the synthetic burst while its buffer was loaded",
);

// 4 — distance attenuation: past its falloff an event makes no sound at all, on either path.
let quiet = created.length;
for (const [type, beyond] of [["flak", 9000], ["explosion", 4000], ["splash", 2500]]) {
  s.event({ type, distance: beyond });
  assert.equal(created.length, quiet, `${type} played from ${beyond} m, past its falloff`);
}
advance(s.ctx, 1);
s.event({ type: "flak", distance: 100 });
assert.ok(created.length > quiet, "flak did not play from 100 m");

// 5 — mute applies immediately, not on the next frame, and pause silences the master.
s.muted = true;
assert.equal(s.master.gain.value, 0, "muting did not drop the master gain on the same tick");
const silent = created.length;
s.event({ type: "gun" });
assert.equal(created.length, silent, "a muted Soundscape still opened a voice");
s.muted = false;
assert.ok(s.master.gain.value > 0, "unmuting did not restore the master gain");
s.update(player, true);
assert.equal(s.master.gain.value, 0, "pause did not silence the master");

// 5b — toggling mute while paused must not reopen the master or let an event through.
quiet = created.length;
s.muted = true;
s.muted = false;
assert.equal(s.master.gain.value, 0, "unmuting while paused reopened the master gain");
for (const type of ["gun", "explosion", "radio", "damage"]) s.event({ type });
assert.equal(created.length, quiet, "a paused Soundscape opened a voice");
s.update(player, false); // back in flight
assert.ok(s.master.gain.value > 0, "leaving the pause did not restore the master gain");

// 6 — the stall horn is edge-triggered: once per entry into the stall, not once per frame. The
// clock advances past the horn's 2.5 s cooldown so only the edge trigger can hold it to one.
s.update(player, false);
let preStall = created.length;
for (let i = 0; i < 20; i += 1) {
  advance(s.ctx, 3);
  s.update({ ...player, stall: 0.9 }, false);
}
let fired = created.slice(preStall).filter((n) => n.kind === "source").length;
assert.equal(fired, 1, `the stall horn fired ${fired} times while held in one stall`);

// ...and it re-arms once the wing is flying again, so the next stall is audible.
preStall = created.length;
advance(s.ctx, 3);
s.update({ ...player, stall: 0 }, false);
s.update({ ...player, stall: 0.9 }, false);
fired = created.slice(preStall).filter((n) => n.kind === "source").length;
assert.equal(fired, 1, "the stall horn did not re-arm after the recovery");

// 7 — dispose() stops every loop AND every sounding one-shot, disconnects, closes the context.
advance(s.ctx, 5);
s.event({ type: "gun" }); // a sampled voice...
s.event({ type: "radio" }); // ...and a synthetic beep, both still sounding
const sounding = [...live].filter((n) => !n.loop);
assert.ok(
  sounding.some((n) => n.kind === "source") && sounding.some((n) => n.kind === "osc"),
  "expected both a sampled gun voice and a synthetic beep to be sounding",
);
assert.ok(sounding.length >= 2, `expected a live gun and beep before dispose, got ${sounding.length}`);
const ctx = s.ctx;
s.dispose();
s.dispose();
assert.ok(ctx.closed, "dispose() left the AudioContext open");
assert.equal(s.ctx, null, "dispose() kept a context reference");
assert.equal(loops().length, 0, "dispose() left a loop running");
assert.ok(
  sounding.every((n) => n.stopped),
  "dispose() left a one-shot sounding",
);
assert.ok(
  sounding.every((n) => n.connected <= 0),
  "dispose() left a one-shot connected",
);
assert.ok(
  sounding.every((n) => n.onended === null),
  "dispose() left an onended handler that could refill the voice map",
);
assert.ok(
  created.filter((n) => n.kind === "source" && n.loop).every((n) => n.connected <= 0),
  "dispose() left a loop node connected",
);
assert.equal(s.active, false, "dispose() left the Soundscape active");

// 8 — a failed fetch reports once and falls back; no unhandled rejection, no missing loop crash.
install();
failNext = new Set(["engine-loop.ogg", "wind-loop.mp3"]);
const infos = [];
const realInfo = console.info;
console.info = (m) => infos.push(String(m));
s = new Soundscape();
s.start();
await settle();
await settle();
console.info = realInfo;
assert.equal(infos.length, 1, `expected one failure report, got ${infos.length}`);
assert.ok(/2 sample\(s\) unavailable/.test(infos[0]), `unexpected report: ${infos[0]}`);
assert.ok(s.engine && !s.engine.stopped, "the synthetic engine was retired even though the loop failed");
s.update(player, false);
s.event({ type: "gun" }); // a loaded sample still works alongside the failed ones
s.dispose();

// 9 — start() after dispose() stays disposed rather than half-rebuilding.
const n = ctxCount;
s.start();
assert.equal(ctxCount, n, "start() after dispose() built a new context");

console.log("check-audio: 12 checks passed");
