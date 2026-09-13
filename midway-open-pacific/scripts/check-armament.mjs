/**
 * Armament check (PRD AC-17, torpedo variants row): four genuinely different torpedoes, release
 * envelopes that reject an illegal launch, and gun batteries chosen by airframe rather than by team.
 *
 * The unit assertion is the important one: every simulation speed is m/s, and a knots regression is
 * silent — 33.5 instead of 17.23 still flies, just twice as fast. Each speed is asserted inside a
 * band no knots value of the same weapon can occupy.
 *
 * Uses the esbuild vite already installs. Run: node scripts/check-armament.mjs
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const built = await build({
  stdin: { contents: 'export * from "./src/sim/armament.ts";', loader: "ts", resolveDir: root },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  write: false,
  logLevel: "silent",
});
const A = await import(`data:text/javascript,${encodeURIComponent(built.outputFiles[0].text)}`);

const IDS = ["mk13", "type91", "type95", "mk14"];

// 1 — four variants, genuinely different. Lengths and ranges are all distinct, and no two share a
// whole dimension set. The two 21-inch submarine weapons DO share a body diameter (0.533 m), which is
// historically correct, so only the full signature has to be unique.
{
  const all = IDS.map((id) => A.torpedoVariant(id));
  assert.equal(new Set(all.map((v) => v.length)).size, 4, "two variants share a body length");
  assert.equal(
    new Set(all.flatMap((v) => v.settings.map((s) => s.range))).size,
    all.reduce((n, v) => n + v.settings.length, 0),
    "two speed settings share a range",
  );
  const signature = (v) =>
    JSON.stringify([v.length, v.bodyDiameter, v.warheadMass, v.settings.map((s) => [s.speed, s.range])]);
  assert.equal(new Set(all.map(signature)).size, 4, "two variants share a whole dimension set");
  assert.equal(A.torpedoVariant("type95").bodyDiameter, A.torpedoVariant("mk14").bodyDiameter,
    "the Type 95 and Mark 14 are both 21-inch weapons; that equality is intentional");
  assert.ok(A.torpedoVariant("type91").bodyDiameter < 0.5, "the Type 91 is the slim 17.7-inch weapon");

  // Reliability is a labelled approximation, not a claim of fact, and not falsely precise.
  for (const v of all) {
    assert.ok(v.reliability.runs > 0 && v.reliability.runs < 1, `${v.id}: reliability out of range`);
    assert.ok(
      /GAME APPROXIMATION/.test(v.reliability.provenance),
      `${v.id}: reliability is not labelled as a game approximation`,
    );
    assert.ok(
      Math.abs(v.reliability.runs * 20 - Math.round(v.reliability.runs * 20)) < 1e-9,
      `${v.id}: reliability ${v.reliability.runs} is more precise than the evidence supports`,
    );
    assert.ok(v.source.includes("reference-dimensions.md"), `${v.id}: no source note`);
  }
}

// 2 — every speed is m/s. A knots figure for any of these weapons is 31.5 kn or more, so a band that
// ends below 30 fails on a unit regression while passing every cited m/s value.
{
  for (const id of IDS) {
    for (const s of A.torpedoVariant(id).settings) {
      assert.ok(s.speed >= 12 && s.speed <= 30, `${id} setting ${s.label}: ${s.speed} is not m/s`);
      const knots = s.speed / 0.514444;
      assert.ok(knots > 30, `${id}: ${s.label} does not read as a 1942 torpedo speed`);
    }
  }
  // The two aerial envelopes keep the game's own m/s maxima, not their knots equivalents.
  assert.equal(A.torpedoVariant("mk13").release.maxSpeed, 57, "the Mark 13 release maximum moved off 57 m/s");
  assert.equal(A.torpedoVariant("type91").release.maxSpeed, 88, "the Type 91 release maximum moved off 88 m/s");
}

// 3 — for each variant, a launch inside the envelope is accepted and one above it is rejected.
{
  for (const id of IDS) {
    const e = A.torpedoVariant(id).release;
    const mid = (lo, hi) => (lo + hi) / 2;
    const inside = { altitude: mid(e.minAltitude, e.maxAltitude), speed: mid(e.minSpeed, e.maxSpeed) };
    assert.ok(A.releaseLegal(id, inside).legal, `${id}: a launch inside its own envelope was refused`);

    const tooHigh = A.releaseLegal(id, { ...inside, altitude: e.maxAltitude + 10 });
    assert.equal(tooHigh.legal, false, `${id}: a launch above its ceiling was accepted`);
    assert.deepEqual(tooHigh.problems, ["TOO HIGH"], `${id}: wrong reason for a high launch`);

    const tooFast = A.releaseLegal(id, { ...inside, speed: e.maxSpeed + 10 });
    assert.equal(tooFast.legal, false, `${id}: a launch over its speed limit was accepted`);
    assert.deepEqual(tooFast.problems, ["TOO FAST"], `${id}: wrong reason for a fast launch`);

    const tooLow = A.releaseLegal(id, { ...inside, altitude: e.minAltitude - 10 });
    assert.equal(tooLow.legal, false, `${id}: a launch below its floor was accepted`);
  }
  // The two launchers really are different: a submarine shoots at or below the surface, an aircraft
  // above it, and neither envelope admits the other's launch point.
  assert.equal(A.releaseLegal("mk14", { altitude: 10, speed: 2 }).legal, false, "a Mark 14 was fired in the air");
  assert.equal(A.releaseLegal("mk13", { altitude: -14, speed: 45 }).legal, false, "a Mark 13 was dropped underwater");
  assert.ok(A.releaseLegal("type95", { altitude: -14, speed: 2 }).legal, "a periscope-depth Type 95 shot was refused");

  // The player-facing gate still reads the same two envelopes it always did, and now picks them by
  // airframe: a Kate gets the Type 91 ceiling even with no team set.
  assert.equal(A.torpedoEnvelope({ airframe: "tbd", y: 12, speed: 45 }).maxHeight, 15.5);
  assert.equal(A.torpedoEnvelope({ airframe: "tbd", y: 12, speed: 45 }).maxSpeed, 57);
  assert.equal(A.torpedoEnvelope({ airframe: "kate", y: 30, speed: 70 }).maxHeight, 45);
  assert.equal(A.torpedoEnvelope({ airframe: "kate", y: 30, speed: 70 }).maxSpeed, 88);
  assert.ok(A.torpedoEnvelope({ airframe: "tbd", y: 12, speed: 45, roll: 0, pitch: 0 }).safe);
  assert.deepEqual(A.torpedoEnvelope({ airframe: "tbd", y: 30, speed: 45, roll: 0, pitch: 0 }).problems, ["TOO HIGH"]);
  // Legacy path: no airframe id, so the team picks, exactly as before this record existed.
  assert.equal(A.torpedoEnvelope({ team: "jp", y: 30, speed: 70 }).maxHeight, 45);
  assert.equal(A.torpedoEnvelope({ team: "us", y: 12, speed: 45 }).maxHeight, 15.5);
}

// 4 — guns come from the airframe. The Kate fires aft only; the TBD does not inherit the SBD's.
{
  const kate = A.gunsFor("kate");
  assert.ok(kate.mounts.length > 0, "the Kate has no guns at all");
  assert.ok(kate.mounts.every((m) => m.facing === "rear"), "the Kate was given a forward-firing gun");
  assert.equal(kate.mounts.filter((m) => m.facing === "forward").length, 0, "the Kate has a forward mount");
  assert.equal(kate.mounts[0].caliber, 7.7, "the Kate's defensive gun is the 7.7 mm Type 92");

  for (const id of ["sbd", "zero"]) {
    const b = A.gunsFor(id);
    assert.ok(b.mounts.some((m) => m.facing === "forward"), `${id} has no forward battery`);
  }
  const tbd = A.gunsFor("tbd");
  const sbd = A.gunsFor("sbd");
  const fwd = (b) => b.mounts.filter((m) => m.facing === "forward").map((m) => [m.caliber, m.count, m.family]);
  assert.notDeepEqual(fwd(tbd), fwd(sbd), "the TBD inherited the SBD's forward battery");
  assert.deepEqual(fwd(tbd), [[7.62, 1, "gun30"]], "the TBD's cowl gun is one rifle-calibre Browning");
  assert.deepEqual(fwd(sbd), [[12.7, 2, "gun50"]], "the SBD's cowl battery is a .50 pair");
  assert.ok(tbd.mounts.some((m) => m.facing === "rear"), "the TBD lost its rear-cockpit gun");

  // Nothing is selected by team: a Japanese airframe with a forward battery (the Zero) and one
  // without (the Kate) must not resolve to the same guns.
  assert.notDeepEqual(A.gunsFor("zero").mounts, kate.mounts, "the Kate and the Zero share a battery");

  // Every family is a cue key the audio bank already carries.
  const FAMILIES = new Set(["gun50", "gun30", "gun77", "cannon20"]);
  for (const id of ["sbd", "tbd", "kate", "zero"])
    for (const m of A.gunsFor(id).mounts)
      assert.ok(FAMILIES.has(m.family), `${id}: ${m.family} is not an existing cue family`);
}

// 5 — an unknown id throws a named error instead of defaulting to something plausible.
{
  assert.throws(() => A.gunsFor("b25"), { name: "UnknownAirframeGunsError" });
  assert.throws(() => A.gunsFor(""), { name: "UnknownAirframeGunsError" });
  assert.throws(() => A.torpedoVariant("mk48"), { name: "UnknownTorpedoVariantError" });
  assert.throws(() => A.releaseLegal("torpedo", { altitude: 10, speed: 45 }), {
    name: "UnknownTorpedoVariantError",
  });
  assert.equal(A.torpedoVariantForAirframe("sbd"), null, "a dive bomber was given a torpedo");
  assert.equal(A.torpedoVariantForAirframe(undefined), null);
  assert.equal(A.torpedoVariantForAirframe("tbd").id, "mk13");
  assert.equal(A.torpedoVariantForAirframe("kate").id, "type91");
}

// 6 — arming distance is respected: a hit short of the run does not detonate.
{
  for (const id of IDS) {
    const d = A.torpedoVariant(id).armingDistance;
    assert.ok(d > 100, `${id}: an arming run of ${d} m would let a weapon detonate on its launcher`);
    assert.equal(A.torpedoArmed(id, d - 1), false, `${id}: detonated inside its arming distance`);
    assert.equal(A.torpedoArmed(id, 0), false, `${id}: detonated at the launch point`);
    assert.equal(A.torpedoArmed(id, d), true, `${id}: failed to arm at its arming distance`);
    assert.equal(A.torpedoArmed(id, d + 500), true, `${id}: failed to arm well past the run`);
  }
  assert.ok(/GAME APPROXIMATION/.test(A.ARMING_PROVENANCE), "the arming figures are not labelled");

  // The Mark 14 is the only weapon that does not run at the depth it was set to.
  assert.equal(A.actualRunDepth("mk14", 6), 9.2, "the Mark 14 lost its 1942 deep-running error");
  assert.equal(A.actualRunDepth("type91", 6), 6, "the Type 91 gained a depth error it never had");
  assert.equal(A.actualRunDepth("type91", 0.5), 2, "a Type 91 ran shallower than its 2 m minimum");
}

console.log(`check-armament: 6 checks passed (${IDS.length} torpedo variants, 4 gun batteries)`);
