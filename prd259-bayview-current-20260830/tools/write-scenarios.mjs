/**
 * Writes the scenarios that gate this round of fixes.
 *
 * They live in a script rather than hand-edited JSON because each one pins a number measured
 * from a real run — pool capacities, spike budgets, shot counts — and those numbers have to be
 * changed together with the code that produced them.
 */
import { writeFileSync } from "node:fs";

const diagnostics = { noConsoleErrors: true, noNetworkErrors: true, runtimeReady: true };

const base = (name, steps, assert, setup) => ({
  name,
  target: "web",
  schemaVersion: 1,
  viewport: { width: 1280, height: 720 },
  warmupFrames: 30,
  subject: "player",
  ...(setup === undefined ? {} : { setup }),
  steps,
  assert,
});

/** Spawn aim is delivered through the placeholder's rotation; pitch is a turn about X. */
const aim = (x, y, z, qx) => ({
  entities: [
    { entity: "player", position: [x, y, z], rotation: [qx, 0, 0, Number((1 - qx * qx) ** 0.5).toFixed(5) * 1] },
  ],
});

const write = (name, value) =>
  writeFileSync(`playtests/${name}.playtest.json`, `${JSON.stringify(value, null, 2)}\n`);

write(
  "hold-to-fire",
  base(
    "hold-to-fire",
    [
      { kind: "input", label: "trigger-held", press: "Space", holdTicks: 90, release: true },
      { kind: "wait", label: "settle", waitTicks: 20, release: true },
    ],
    {
      diagnostics,
      resources: [{ id: "state", path: "shots", gte: 8 }],
      components: [
        {
          entity: "audio",
          component: "playerShots",
          gte: 8,
          allowTrivial:
            "the counter rests at zero until a round is fired with sound; one uninterrupted trigger hold has to produce at least eight, which the edge-triggered fire path this replaces could not do at any hold length",
        },
      ],
    },
  ),
);

write(
  "bullet-holes",
  base(
    "bullet-holes",
    [
      { kind: "input", label: "burst", press: "Space", holdTicks: 45, release: true },
      { kind: "wait", label: "settle", waitTicks: 20, release: true },
    ],
    {
      diagnostics,
      components: [
        {
          entity: "decals",
          component: "placed",
          gte: 1,
          allowTrivial:
            "the field places nothing until a round lands on town geometry, so the resting zero cannot satisfy this",
        },
        {
          entity: "decals",
          component: "capacity",
          equals: 224,
          allowTrivial:
            "capacity is fixed by construction; pinning it is how a later change that grows the mark pool per shot fails a gate instead of leaking quietly",
        },
      ],
    },
    // Aimed 55 degrees down at the deck. A shallower angle put the burst into a scoring plate,
    // which the fire path consumes before any mark is stamped.
    aim(0, 0.89, 32, -0.46175),
  ),
);

write(
  "flash-retires",
  base(
    "flash-retires",
    [
      { kind: "input", label: "sustained-fire", press: "Space", holdTicks: 90, release: true },
      { kind: "wait", label: "trigger-up", waitTicks: 30, release: true },
      { kind: "wait", label: "long-after", waitTicks: 120, release: true },
    ],
    {
      diagnostics,
      components: [
        {
          entity: "rifle",
          component: "flashOpacity",
          atSteps: [{ label: "long-after", equals: 0 }],
        },
        {
          entity: "enemy-flashes",
          component: "peakOpacity",
          atSteps: [{ label: "long-after", equals: 0 }],
          allowTrivial:
            "the pool rests at zero and that is exactly the contract: two seconds after the last round, no muzzle flash anywhere may still be lit. The single shared flash this replaces was held open indefinitely by sustained fire from any soldier",
        },
      ],
    },
  ),
);

write(
  "audio-voices-bounded",
  base(
    "audio-voices-bounded",
    [
      { kind: "input", label: "advance", press: "KeyW", holdTicks: 150, release: true },
      { kind: "input", label: "firefight", press: "Space", holdTicks: 240, release: true },
      { kind: "input", label: "reload", press: "KeyR", holdTicks: 3, release: true },
      { kind: "input", label: "more-fire", press: "Space", holdTicks: 240, release: true },
      { kind: "wait", label: "settle", waitTicks: 120, release: true },
    ],
    {
      diagnostics,
      components: [
        {
          entity: "audio",
          component: "voicePoolSize",
          lte: 48,
          allowTrivial:
            "this is the count of retired voices the engine bus holds for reuse. It starts at zero and rises only to peak concurrency, so a bounded reading after 750 ticks of sustained fire is the assertion; under the per-cue voice allocation this replaces there was no reuse at all and the equivalent figure was every cue ever played, still parented to the scene",
        },
        {
          entity: "audio",
          component: "sceneVoiceNodes",
          lte: 40,
          allowTrivial:
            "this counts Audio objects parented in the scene. Under the per-cue allocation it replaces, a firefight of this length left well over a hundred behind; a bounded reading after 750 ticks of fire and movement is the assertion",
        },
        { entity: "audio", component: "playerShots", gte: 20 },
      ],
    },
  ),
);

write(
  "breakable-shatters",
  base(
    "breakable-shatters",
    [
      { kind: "wait", label: "settle", waitTicks: 20, release: true },
      { kind: "input", label: "shoot-pot", press: "Space", holdTicks: 20, release: true },
      { kind: "wait", label: "pieces-fly", waitTicks: 30, release: true },
    ],
    {
      diagnostics,
      components: [
        {
          entity: "breakables",
          component: "broken",
          gte: 1,
          allowTrivial:
            "no vessel is broken until a round reaches one; the resting zero cannot satisfy this",
        },
        {
          entity: "breakables",
          component: "liveShards",
          gte: 1,
          allowTrivial:
            "shards carry a physics body only while they are flying, so the resting zero cannot satisfy this either",
        },
      ],
    },
    // Three metres north of the amphora at (-8.4, 18.6), aimed down at its body.
    aim(-8.4, 0.89, 21.6, -0.2045),
  ),
);

write(
  "frame-smoothness",
  base(
    "frame-smoothness",
    [
      { kind: "input", label: "advance", press: "KeyW", holdTicks: 240, release: true },
      { kind: "input", label: "firefight", press: "Space", holdTicks: 300, release: true },
      { kind: "input", label: "reload", press: "KeyR", holdTicks: 3, release: true },
      { kind: "input", label: "retreat", press: "KeyS", holdTicks: 240, release: true },
      { kind: "input", label: "more-fire", press: "Space", holdTicks: 300, release: true },
      { kind: "wait", label: "settle", waitTicks: 240, release: true },
    ],
    {
      diagnostics,
      components: [
        { entity: "frame", component: "playFrames", gte: 1000 },
        {
          entity: "frame",
          component: "playSpikes",
          lte: 8,
          allowTrivial:
            "playSpikes counts frames whose real wall-clock cost passed 33 ms after the opening 1.5 s of pipeline compilation — the hitches a player feels mid-round. It rests at zero and only rises. The same scenario on the code this replaces reported 27; measured runs after the fixes land between 3 and 6, so 8 is the observed ceiling plus headroom for a shared machine rather than a number tuned to one lucky run",
        },
        {
          entity: "frame",
          component: "p95",
          lte: 20,
          allowTrivial:
            "p95 is zero until frames have been measured; the assertion is that nineteen frames in twenty fit a 20 ms budget across a whole firefight",
        },
      ],
    },
  ),
);

console.log("scenarios written");
