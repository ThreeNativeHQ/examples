/**
 * Watch the office's rigs for a while and say whether they are actually animating.
 *
 * `tools/capture-lock.sh node tools/animation-probe.mjs <url> [--seconds 60] [--out DIR]`
 *
 * Why this exists rather than another playtest assertion: the runner's `animation` assertion reads
 * `AnimationPlayer.{current,advancedFrames,finished}`, and every one of those three is *identical*
 * whether or not the clip's tracks bind to the skeleton. The T-pose bug — every rotation track
 * written with the glTF path "quaternion" instead of "rotation" — advanced the mixer sixty times a
 * second, reported the right clip name, and drew a mannequin standing in its bind pose. A gate
 * that would have caught it has to measure the *pose*, and the only pose the game publishes is
 * `window.__hq().actors[].hand`, the world position of `hand_r`.
 *
 * Everything here is measured in GAME seconds, never wall seconds. The office runs a fixed 1/60 s
 * step with no catch-up, so a capture host that renders at 10 fps advances the world at 0.166x
 * wall clock — and a transition timed against a stopwatch then looks like it blew a timeout it
 * never came near. `clipAge` is the clock `Worker` itself counts against, so it is the clock here.
 *
 * Reports, and fails on:
 *
 *   - hand travel per settled clip, which is zero for a rig stuck in its bind pose;
 *   - every sit/stand one-shot's duration in game seconds, against the clip's authored duration
 *     and against Worker's 2.5 s TRANSITION_TIMEOUT_SECONDS — a transition that only ever ends by
 *     timeout is a broken transition wearing a working one's clothes;
 *   - whether a settled worker's clip is its state's clip;
 *   - the loop's observed period against its authored duration, which is how a clip played at the
 *     wrong rate shows up.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { authoredBoneMotion } from "./clip-motion.mjs";

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith("--")) ?? "http://localhost:5174/";
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};
const seconds = Number.parseFloat(flag("seconds", "60"));
const out = flag("out", "/tmp/hq-animation-probe");
mkdirSync(out, { recursive: true });

/** Worker.ts: the longest a sit or stand may run before the state's clip takes over regardless. */
const TRANSITION_TIMEOUT_SECONDS = 2.5;
/** A one-shot ending within this of the timeout ended *by* the timeout, not by the clip. */
const TIMEOUT_MARGIN = 0.2;
/** Below this much hand_r travel a "playing" clip is a mannequin holding its bind pose. */
const FROZEN_METRES = 0.02;
/**
 * How far below its authored rate a loop may play before this is a bug.
 *
 * `AnimationPlayer` matches a *travelling* clip's rate to the ground its body covers, and clamps
 * that ratio into [0.15, 3]. A stationary worker covers no ground, so any clip the player believes
 * is travelling gets 0.15x — a sixth speed — and a clip only has to carry a millimetre-per-second
 * of root drift to be believed. Half rate is the line: below it nobody reads the animation.
 */
const SLOW_RATE = 0.5;
/** A loop measured over less settled time than this cannot support a rate claim. */
const RATE_MIN_SETTLED_SECONDS = 2;

/** state -> clip, mirrored from src/office/states.ts so a drift there fails here loudly. */
const CLIP_FOR_STATE = {
  arriving: "Walk_Formal_Loop",
  working: "Typing_Loop",
  thinking: "Sitting_Talking_Loop",
  blocked: "Texting_Standing_Loop",
  idle: "Sitting_Idle_Loop",
  filing: "Filing_Use_Loop",
  faxing: "Fax_Use_Loop",
  leaving: "Walk_Loop",
};
const ONE_SHOTS = new Set(["Sitting_Enter", "Sitting_Exit", "SitToType", "TypeToSit"]);

/** Authored clip durations, read from the shipped assets rather than hard-coded. */
async function clipDurations() {
  const io = new NodeIO();
  const durations = {};
  for (const path of ["assets/worker.glb", "assets/worker-mixamo.glb"]) {
    const doc = await io.read(path);
    for (const anim of doc.getRoot().listAnimations()) {
      let end = 0;
      for (const channel of anim.listChannels()) {
        const input = channel.getSampler()?.getInput()?.getArray();
        if (input?.length) end = Math.max(end, input[input.length - 1]);
      }
      if (durations[anim.getName()] === undefined) durations[anim.getName()] = Number(end.toFixed(3));
    }
  }
  return durations;
}

const durations = await clipDurations();
/** Authored hand_r travel per clip-second, for turning an observed speed into a playback rate. */
const authored = await authoredBoneMotion("hand_r");

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const consoleErrors = [];
const frameBudget = [];
page.on("pageerror", (error) => consoleErrors.push(String(error).slice(0, 300)));
page.on("console", (message) => {
  const text = message.text();
  if (text.startsWith("TN_FRAME_BUDGET")) frameBudget.push(text.slice(0, 400));
  if (message.type() === "error") consoleErrors.push(text.slice(0, 300));
});
await page.goto(url, { waitUntil: "load" });

let ready = false;
for (let attempt = 0; attempt < 60; attempt += 1) {
  ready = await page.evaluate(() => typeof globalThis.__hq === "function");
  if (ready) break;
  await page.waitForTimeout(1000);
}
if (!ready) {
  await browser.close();
  console.error("NOT_OBSERVED: window.__hq never appeared — the office did not reach its frame loop.");
  process.exit(3);
}

// Poll rather than ride requestAnimationFrame: the game owns rAF and a second callback registered
// beside it fires roughly every fifth frame here, which is too coarse to time a 1.3 s one-shot.
// `frames` is the game's own tick counter, so polling fast and de-duplicating on it captures every
// frame the office actually ran and no frame twice.
const installSampler = () => page.evaluate(() => {
  const samples = [];
  globalThis.__probeSamples = samples;
  let lastFrame = -1;
  const handle = setInterval(() => {
    const read = globalThis.__hq?.();
    if (read === undefined || read.frames === lastFrame) return;
    lastFrame = read.frames;
    samples.push({
      t: performance.now() / 1000,
      frames: read.frames,
      dt: read.dt,
      actors: (read.actors ?? []).map((a) => ({
        id: a.id,
        state: a.state,
        phase: a.phase,
        clip: a.clip,
        clipAge: a.clipAge,
        advancedFrames: a.advancedFrames,
        transitioning: a.transitioning,
        settled: a.settled,
        stateChanges: a.stateChanges,
        hand: a.hand,
        position: a.position,
      })),
    });
  }, 4);
  globalThis.__probeStop = () => clearInterval(handle);
});
await installSampler();

process.stderr.write(`probing ${url} for ${String(seconds)}s of wall clock…\n`);
// Drain in windows rather than once at the end: a dev-server hot reload wipes page globals, and a
// single final read of a wiped global loses the whole run with nothing to show for it.
const samples = [];
const drain = async () => {
  const batch = await page.evaluate(() => {
    // splice, never reassign: the sampler holds the array by reference, and handing it a fresh
    // one leaves it filling an array nothing reads.
    return globalThis.__probeSamples?.splice(0) ?? [];
  });
  samples.push(...batch);
};
const deadline = Date.now() + seconds * 1000;
let reloads = 0;
while (Date.now() < deadline) {
  await page.waitForTimeout(Math.min(5000, Math.max(250, deadline - Date.now())));
  await drain();
  const alive = await page.evaluate(() => typeof globalThis.__probeStop === "function");
  if (!alive) {
    reloads += 1;
    process.stderr.write(`probe: page reloaded, reinstalling the sampler (${String(reloads)})\n`);
    await installSampler();
  }
}
await page.screenshot({ path: `${out}/probe-final.png` });
await drain();
await page.evaluate(() => globalThis.__probeStop?.());
await browser.close();
if (reloads > 0)
  process.stderr.write(
    `probe: the page reloaded ${String(reloads)} time(s) during the run; runs spanning a reload are discontinuous.\n`,
  );

writeFileSync(`${out}/samples.json`, JSON.stringify({ samples, url, seconds }, null, 1));

// ---------------------------------------------------------------- analysis

/** Hand position in the worker's own frame, so walking does not read as animation. */
function relativeHand(actor) {
  if (actor.hand === undefined || actor.position === undefined) return undefined;
  return [
    actor.hand[0] - actor.position[0],
    actor.hand[1] - actor.position[1],
    actor.hand[2] - actor.position[2],
  ];
}

const wallSpan = samples.length < 2 ? 0 : samples[samples.length - 1].t - samples[0].t;
const gameFps = wallSpan > 0 ? (samples[samples.length - 1].frames - samples[0].frames) / wallSpan : 0;
const stepSeconds = samples.at(-1)?.dt ?? 1 / 60;
/** Game seconds per wall second. The office is a fixed step with no catch-up, so this is not 1. */
const timeDilation = gameFps * stepSeconds;

const byActor = new Map();
for (const sample of samples) {
  for (const actor of sample.actors) {
    let track = byActor.get(actor.id);
    if (track === undefined) {
      track = [];
      byActor.set(actor.id, track);
    }
    track.push({ ...actor, t: sample.t, frames: sample.frames, rel: relativeHand(actor) });
  }
}

const failures = [];
const notes = [];
const rates = [];

/**
 * Contiguous runs of samples sharing one clip.
 *
 * A run carries its own game-time clock: `clipAge` is what `Worker` counts, and it restarts at
 * zero on every `play`, so a drop in it is a new run even when the clip name repeats.
 */
function runsOf(track) {
  const runs = [];
  let run;
  for (const sample of track) {
    if (run === undefined || run.clip !== sample.clip || sample.clipAge < run.last.clipAge) {
      run = { clip: sample.clip, samples: [sample], last: sample, state: sample.state };
      runs.push(run);
    } else {
      run.samples.push(sample);
      run.last = sample;
      run.state = sample.state;
    }
  }
  return runs;
}

/**
 * Hand travel and reach over a run, plus the run's length in game and wall seconds.
 *
 * `settledOnly` drops the crossfade at the head of every run. It matters more than it sounds: a
 * quarter-second fade carries the hand the whole distance between two poses — half a metre for a
 * stand-to-sit — so a run measured from its first frame reports the *transition* it arrived
 * through, not the loop it is playing. `Worker.settled` is exactly that filter, already written.
 */
function spread(run, settledOnly = false) {
  const chosen = settledOnly ? run.samples.filter((s) => s.settled && !s.transitioning) : run.samples;
  const points = chosen.map((s) => s.rel).filter((r) => r !== undefined);
  if (points.length < 2) return undefined;
  const axes = [0, 1, 2].map((axis) => {
    const values = points.map((p) => p[axis]);
    return Math.max(...values) - Math.min(...values);
  });
  let path = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    path += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  const first = chosen[0];
  const last = chosen[chosen.length - 1];
  const gameSpan = last.clipAge - first.clipAge;
  return {
    axes,
    peakToPeak: Math.max(...axes),
    path,
    gameSpan,
    samples: chosen.length,
    wallSpan: last.t - first.t,
    speed: gameSpan > 0 ? path / gameSpan : 0,
  };
}

/**
 * The clip-time lag at which a run's hand track repeats itself.
 *
 * Resampled onto a uniform grid in `clipAge` first, so a host rendering at a tenth of real time
 * measures the same period as one rendering at full speed.
 */
function observedPeriod(run) {
  const points = run.samples.filter((s) => s.rel !== undefined && s.settled);
  if (points.length < 40) return undefined;
  const gameSpan = points[points.length - 1].clipAge - points[0].clipAge;
  if (gameSpan < 2) return undefined;
  const step = 0.05;
  const grid = [];
  let cursor = 0;
  for (let age = points[0].clipAge; age <= points[points.length - 1].clipAge; age += step) {
    while (cursor + 1 < points.length && points[cursor + 1].clipAge <= age) cursor += 1;
    grid.push(points[cursor].rel);
  }
  let bestLag;
  let bestError = Infinity;
  const maxLag = Math.floor((gameSpan * 0.6) / step);
  for (let lag = Math.floor(0.4 / step); lag < maxLag; lag += 1) {
    let error = 0;
    let count = 0;
    for (let index = 0; index + lag < grid.length; index += 2) {
      const a = grid[index];
      const b = grid[index + lag];
      error += (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
      count += 1;
    }
    if (count < 4) continue;
    error /= count;
    if (error < bestError) {
      bestError = error;
      bestLag = lag * step;
    }
  }
  return {
    lag: bestLag === undefined ? undefined : Number(bestLag.toFixed(2)),
    residual: Number(Math.sqrt(bestError).toFixed(4)),
    searchedTo: Number((maxLag * step).toFixed(2)),
    gameSpan: Number(gameSpan.toFixed(2)),
  };
}

const report = {
  url,
  clipDurations: durations,
  host: {
    wallSeconds: Number(wallSpan.toFixed(2)),
    gameFps: Number(gameFps.toFixed(2)),
    stepSeconds,
    timeDilation: Number(timeDilation.toFixed(3)),
    samples: samples.length,
  },
  actors: {},
  transitions: [],
  rates,
  frameBudget: frameBudget.slice(-2),
  consoleErrors: [...new Set(consoleErrors)].slice(0, 10),
};

for (const [id, track] of byActor) {
  const runs = runsOf(track);
  const actorReport = { runs: [], transitions: [] };
  report.actors[id] = actorReport;

  for (const run of runs) {
    const isOneShot = ONE_SHOTS.has(run.clip);
    // One-shots are never `settled` by definition, so they are measured whole; loops are measured
    // only where the pose on screen is the loop's own, past the crossfade in.
    const measure = (isOneShot ? undefined : spread(run, true)) ?? spread(run);
    const clipped = run === runs[0] || run === runs[runs.length - 1];
    const entry = {
      clip: run.clip,
      state: run.state,
      gameSeconds: measure === undefined ? undefined : Number(measure.gameSpan.toFixed(3)),
      wallSeconds: measure === undefined ? undefined : Number(measure.wallSpan.toFixed(3)),
      samples: measure?.samples ?? run.samples.length,
      handSpeed: measure === undefined ? undefined : Number(measure.speed.toFixed(4)),
      authored: durations[run.clip],
      handPeakToPeak: measure === undefined ? undefined : Number(measure.peakToPeak.toFixed(4)),
      handPath: measure === undefined ? undefined : Number(measure.path.toFixed(4)),
      clipAgeAtEnd: run.last.clipAge,
      clipped,
    };
    actorReport.runs.push(entry);

    if (!isOneShot) continue;
    // `Worker` counts #transitionAge in dt, and clipAge restarts with the one-shot, so the age at
    // the last sample of the run is how far the transition got before something ended it.
    const endedAt = run.last.clipAge;
    const endedByTimeout = endedAt > TRANSITION_TIMEOUT_SECONDS - TIMEOUT_MARGIN;
    const transition = {
      actor: id,
      clip: run.clip,
      gameSeconds: endedAt,
      wallSeconds: entry.wallSeconds,
      authored: durations[run.clip],
      endedBy: clipped ? "probe-window" : endedByTimeout ? "TIMEOUT" : "clip-finished",
      handPeakToPeak: entry.handPeakToPeak,
    };
    actorReport.transitions.push(transition);
    report.transitions.push(transition);
    if (transition.endedBy === "TIMEOUT")
      failures.push(
        `${id}: one-shot ${run.clip} ran ${String(endedAt)} game-seconds (authored ${String(durations[run.clip])}s) and ended on Worker's ${String(TRANSITION_TIMEOUT_SECONDS)}s timeout, not on the clip finishing.`,
      );
    if (!clipped && measure !== undefined && measure.peakToPeak < FROZEN_METRES)
      failures.push(
        `${id}: one-shot ${run.clip} moved hand_r only ${measure.peakToPeak.toFixed(4)} m peak-to-peak — the clip named itself but the rig did not move (bind-pose regression).`,
      );
  }

  // A settled worker must be in its state's own clip. Anything else is a stuck transition or a
  // state that changed without its pose following.
  const settled = track.filter((s) => s.settled && !s.transitioning);
  const wrongClip = settled.filter(
    (s) => CLIP_FOR_STATE[s.state] !== undefined && s.clip !== CLIP_FOR_STATE[s.state],
  );
  if (wrongClip.length > 0) {
    const worst = wrongClip[wrongClip.length - 1];
    failures.push(
      `${id}: settled in state "${worst.state}" while playing "${worst.clip}" (expected "${CLIP_FOR_STATE[worst.state]}") for ${String(wrongClip.length)} of ${String(settled.length)} settled samples.`,
    );
  }

  // Long settled loops are where a frozen rig is unambiguous: a loop that ran for over a game
  // second and moved the hand less than two centimetres is a mannequin, not an animation. And a
  // loop that moves but moves far slower than it was authored to is the other half of the same
  // question — the pose is right, the clock under it is not.
  for (const run of runs) {
    if (ONE_SHOTS.has(run.clip)) continue;
    const measure = spread(run, true);
    if (measure === undefined || measure.gameSpan < 1) continue;
    const reference = authored[run.clip];
    if (measure.peakToPeak < FROZEN_METRES && (reference?.reach ?? 1) > FROZEN_METRES)
      failures.push(
        `${id}: loop ${run.clip} ran ${measure.gameSpan.toFixed(1)} settled game-seconds and moved hand_r ${measure.peakToPeak.toFixed(4)} m peak-to-peak, against ${String(reference?.reach ?? "?")} m authored — the rig is holding a pose.`,
      );
    if (
      reference !== undefined &&
      reference.speed > 0.02 &&
      measure.gameSpan >= RATE_MIN_SETTLED_SECONDS
    ) {
      const rate = measure.speed / reference.speed;
      rates.push({ actor: id, clip: run.clip, rate: Number(rate.toFixed(3)), settledSeconds: Number(measure.gameSpan.toFixed(2)), observed: Number(measure.speed.toFixed(4)), authored: reference.speed });
      if (rate < SLOW_RATE)
        failures.push(
          `${id}: loop ${run.clip} moved hand_r ${measure.speed.toFixed(4)} m per game-second over ${measure.gameSpan.toFixed(1)} settled seconds, against ${String(reference.speed)} m/clip-s authored across the whole loop — about ${rate.toFixed(2)}x. (A short window can sit in a quiet stretch of a long clip, so read this as a direction and a magnitude, not a calibrated rate.)`,
        );
    }
  }

  const longest = runs
    .filter((r) => !ONE_SHOTS.has(r.clip) && durations[r.clip] !== undefined)
    .map((r) => ({ run: r, measure: spread(r, true) }))
    .filter((r) => r.measure !== undefined)
    .sort((a, b) => b.measure.gameSpan - a.measure.gameSpan)[0];
  if (longest !== undefined) {
    const period = observedPeriod(longest.run);
    if (period !== undefined) {
      const authored = durations[longest.run.clip];
      actorReport.period = { clip: longest.run.clip, authored, ...period };
      if (period.lag !== undefined && period.searchedTo >= authored * 0.9) {
        const rate = authored / period.lag;
        actorReport.period.rateEstimate = Number(rate.toFixed(2));
        if (rate > 1.35 || rate < 0.74)
          notes.push(
            `${id}: ${longest.run.clip} repeats every ${String(period.lag)} clip-seconds but is authored at ${String(authored)}s — playing at about ${rate.toFixed(2)}x.`,
          );
      } else if (period.lag !== undefined) {
        actorReport.period.rateEstimate = "window-too-short";
      }
    }
  }
}

writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1));

// ---------------------------------------------------------------- verdict

const line = (text) => process.stdout.write(`${text}\n`);
line(`\n== animation probe: ${url}`);
line(
  `host: ${String(samples.length)} game frames over ${report.host.wallSeconds}s wall = ${report.host.gameFps} fps; fixed step ${String(stepSeconds)}s, so the world runs at ${report.host.timeDilation}x wall clock`,
);
line(`actors: ${String(byActor.size)}\n`);
line("settled loops (hand_r motion in the worker's own frame, game seconds):");
for (const [id, actorReport] of Object.entries(report.actors)) {
  for (const run of actorReport.runs) {
    if (ONE_SHOTS.has(run.clip)) continue;
    if ((run.gameSeconds ?? 0) < 0.5) continue;
    line(
      `  ${id.padEnd(14)} ${String(run.clip).padEnd(22)} ${String(run.gameSeconds).padStart(7)} settled game-s  reach ${String(run.handPeakToPeak ?? "n/a").padStart(7)} m  ${String(run.handSpeed ?? "n/a").padStart(8)} m/game-s`,
    );
  }
  if (actorReport.period !== undefined)
    line(
      `  ${id.padEnd(14)} period: ${actorReport.period.clip} best lag ${String(actorReport.period.lag)} clip-s vs authored ${String(actorReport.period.authored)}s (searched to ${String(actorReport.period.searchedTo)}s) -> rate ~${String(actorReport.period.rateEstimate ?? "n/a")}`,
    );
}
if (rates.length > 0) {
  line("\nplayback rate (observed hand_r speed / the clip's mean authored hand_r speed):");
  for (const entry of rates)
    line(
      `  ${entry.actor.padEnd(14)} ${entry.clip.padEnd(22)} ${String(entry.observed).padStart(7)} / ${String(entry.authored).padStart(7)} m/s = ${entry.rate.toFixed(2)}x over ${String(entry.settledSeconds)} settled game-s`,
    );
}
line("\none-shot transitions (game seconds):");
if (report.transitions.length === 0) line("  (none seen in this window)");
for (const transition of report.transitions)
  line(
    `  ${transition.actor.padEnd(14)} ${transition.clip.padEnd(14)} ran ${String(transition.gameSeconds).padStart(6)} game-s (authored ${String(transition.authored)}s, ${String(transition.wallSeconds)}s wall) ended by ${transition.endedBy}, hand reach ${String(transition.handPeakToPeak ?? "n/a")} m`,
  );

if (notes.length > 0) {
  line("\nnotes:");
  for (const note of notes) line(`  - ${note}`);
}
if (report.frameBudget.length > 0) {
  line("\nframe budget:");
  for (const entry of report.frameBudget) line(`  ${entry}`);
}
if (report.consoleErrors.length > 0) {
  line("\npage errors:");
  for (const error of report.consoleErrors) line(`  - ${error}`);
}
// Fail closed. A run that observed no worker, or that ran while the page was throwing, proves
// nothing about animation — and a green line under it is worse than no line at all.
if (byActor.size === 0)
  failures.push(
    "no worker was ever observed — the office had no sessions, so this run proves nothing about animation.",
  );
if (report.consoleErrors.length > 0)
  failures.push(`the page reported ${String(report.consoleErrors.length)} error(s) during the run.`);
if (report.transitions.every((t) => t.endedBy === "probe-window") && report.transitions.length > 0)
  failures.push("every one-shot seen was cut by the probe window; nothing about transitions was proved.");

line("");
if (failures.length > 0) {
  line("FAIL:");
  for (const failure of failures) line(`  - ${failure}`);
  process.exit(1);
}
line("PASS: every settled worker played its state's clip, moved its rig, and finished its one-shots.");
