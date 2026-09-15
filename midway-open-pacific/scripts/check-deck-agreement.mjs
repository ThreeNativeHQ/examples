/**
 * Deck-agreement check (PRD-midway-asset-battle-integration AC-6).
 *
 * `check-geometry.mjs` proves a `Battle` is sized before a renderer and that constructing a
 * `WorldView` writes nothing back. This one stays a level higher and proves only what a `Battle`
 * exposes: every hull carries its own finite geometry from construction, that geometry is stable
 * under the running simulation, the carrier corridors match the recorded survey, the HUD's "READY
 * FOR L" cue and `finalReady` are the same gate on every frame of a real approach, a diversion to a
 * second deck recovers on *that* ship's datum and corridor, and a deck that cannot take an aircraft
 * refuses it with a readable reason until it can.
 *
 * No module under `src/render/` is imported: the point is that a `Battle` with no renderer at all
 * already owns the numbers the drawn world uses.
 *
 * Uses the esbuild vite already installs. Run: node scripts/check-deck-agreement.mjs
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const built = await build({
  stdin: {
    contents: `
      export { Battle } from "./src/sim/battle.ts";
      export { finalReady, lineUpLimit, FINAL } from "./src/sim/recovery.ts";
      export { gearClearance } from "./src/sim/flight.ts";
    `,
    loader: "ts",
    resolveDir: root,
  },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  write: false,
  logLevel: "silent",
});
const { Battle, finalReady, lineUpLimit, FINAL, gearClearance } = await import(
  `data:text/javascript,${encodeURIComponent(built.outputFiles[0].text)}`
);

const SEED = 19420604;
const STEP = 1 / 30;
const failures = [];
/** Run one labelled claim; a failed assert is reported and the rest still run. */
function claim(name, fn) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    failures.push({ name, message: err.message });
    console.log(`FAIL  ${name}\n      ${err.message}`);
  }
}
/** Step a battle for `seconds` at the fixed 1/30 s the sim itself uses. */
function steps(b, seconds) {
  for (let i = 0; i < Math.round(seconds / STEP); i += 1) b.step(STEP, {});
}
/** Put the player astern of `s` at altitude `y` and press H, as a real return leg starts. */
function inbound(b, s, metres = 4500, y = 900) {
  const f = { x: Math.sin(s.heading), z: -Math.cos(s.heading) };
  Object.assign(b.player, {
    x: s.x - f.x * metres,
    y,
    z: s.z - f.z * metres,
    heading: s.heading,
    pitch: 0,
    roll: 0,
    speed: 100,
    vx: f.x * 100,
    vy: 0,
    vz: f.z * 100,
    gear: true,
    gearPos: 1,
    autopilot: false,
    landingAssist: null,
  });
  b.playerFlight.reset();
  b.goHome();
}
const GEOMETRY = ["hullLength", "hullBeam", "draught", "deckHeight", "deckLength", "deckWidth", "deckBeam"];

/**
 * The carrier corridors exactly as `CARRIER_DECKS` records them in src/sim/battle.ts, read back from
 * the file so a table edit has to move this check with it rather than drift silently.
 */
const RECORDED_DECKS = {
  "USS Enterprise": { deckLength: 220, deckWidth: 20, deckHeight: 20.06, deckBeam: 32.4 },
  "USS Hornet": { deckLength: 220, deckWidth: 20, deckHeight: 20.06, deckBeam: 32.4 },
  Akagi: { deckLength: 220, deckWidth: 20, deckHeight: 20.06, deckBeam: 31.3 },
  // CV-5 is drawn from the supplied `hornet.glb` sister hull (src/render/imported-ships.ts), so she
  // carries CV-6 and CV-8's deck. The retired `carrier.yorktown.glb` measured 240 x 32 / 12.54 and
  // remains a correct import; it is simply no longer the model this ship is drawn from.
  "USS Yorktown": { deckLength: 220, deckWidth: 20, deckHeight: 20.06, deckBeam: 32.4 },
  Kaga: { deckLength: 230, deckWidth: 18, deckHeight: 15.76, deckBeam: 52 },
  Soryu: { deckLength: 220, deckWidth: 14, deckHeight: 12.89, deckBeam: 34 },
  Hiryu: { deckLength: 220, deckWidth: 14, deckHeight: 12.92, deckBeam: 40 },
};

// ---------------------------------------------------------------------------------------------
// AC-6 — a pure Battle already carries every hull's own geometry
// ---------------------------------------------------------------------------------------------

claim("AC-6 a fresh Battle sizes every hull before anything renders", () => {
  const b = new Battle(SEED);
  assert.equal(b.ships.length, 19, "the fleet is the seventeen original hulls plus the two support cruisers");
  for (const s of b.ships) {
    for (const field of ["deckHeight", "hullLength", "hullBeam", "draught"]) {
      const value = s[field];
      assert.ok(
        Number.isFinite(value) && value > 0,
        `${s.name}: ${field} is ${JSON.stringify(value)} before any step or render`,
      );
    }
    assert.equal(s.length, undefined, `${s.name} still carries the ambiguous 'length' field`);
    assert.equal(s.width, undefined, `${s.name} still carries the ambiguous 'width' field`);
  }
});

claim("AC-6 no hull's geometry changes as the battle runs", () => {
  const b = new Battle(SEED);
  b.start();
  b.player.mode = "spectator";
  const before = new Map(b.ships.map((s) => [s.id, GEOMETRY.map((k) => s[k])]));
  steps(b, 240);
  const changed = [];
  for (const s of b.ships) {
    if (s.sunk) continue;
    const was = before.get(s.id);
    const now = GEOMETRY.map((k) => s[k]);
    if (GEOMETRY.some((k, i) => !Object.is(was[i], now[i]))) changed.push(s.name);
  }
  assert.deepEqual(changed, [], `geometry moved under the running battle: ${changed.join(", ")}`);
  assert.ok(b.ships.some((s) => !s.sunk), "some hull must survive the run for the comparison to mean anything");
});

claim("AC-6 the carrier corridors match the recorded survey within 0.1 m", () => {
  const b = new Battle(SEED);
  const mismatches = [];
  for (const [name, recorded] of Object.entries(RECORDED_DECKS)) {
    const s = b.ships.find((x) => x.name === name);
    assert.ok(s, `${name} is missing from the fleet`);
    for (const field of ["deckLength", "deckWidth", "deckHeight", "deckBeam"]) {
      const delta = Math.abs(s[field] - recorded[field]);
      if (delta > 0.1) mismatches.push(`${name}.${field}: live ${s[field]}, recorded ${recorded[field]} (${delta.toFixed(3)} m)`);
    }
  }
  assert.deepEqual(mismatches, [], `a hull disagrees with its recorded corridor:\n      - ${mismatches.join("\n      - ")}`);
});

// ---------------------------------------------------------------------------------------------
// AC-6 — finalReady and the HUD cue are the same gate
// ---------------------------------------------------------------------------------------------

claim("AC-6 the HUD's READY FOR L cue and finalReady agree on every frame of an approach", () => {
  const b = new Battle(SEED);
  b.start(true);
  inbound(b, b.recoveryCarrier);
  const disagreements = [];
  let readyFrames = 0;
  for (let i = 0; i < 60 * 300 && b.status === "playing"; i += 1) {
    b.step(1 / 60, {});
    const ship = b.recoveryCarrier;
    const gate = finalReady(b.player, ship);
    // Exactly the condition src/hud.ts uses to print the cue line.
    const hudOffers = b.player.mode === "flight" && b.player.nav === "home" && b.approach().cues.includes("READY FOR L");
    if (gate !== hudOffers) {
      disagreements.push(`t=${b.time.toFixed(2)} gate=${gate} hud=${hudOffers} [${b.approach().cues.join(" · ")}]`);
    }
    if (gate) readyFrames += 1;
  }
  assert.deepEqual(
    disagreements,
    [],
    `the cue and the gate disagreed on ${disagreements.length} frame(s):\n      - ${disagreements.slice(0, 3).join("\n      - ")}`,
  );
  assert.ok(readyFrames > 0, "the guided approach never reached the envelope, so the agreement proves nothing");
});

// ---------------------------------------------------------------------------------------------
// AC-6 — a diversion recovers on the second deck's own datum and corridor
// ---------------------------------------------------------------------------------------------

claim("AC-6 a diversion recovers on the second deck's own datum and corridor", () => {
  const b = new Battle(SEED);
  b.selectAssignment("operation");
  b.start(true);
  const launchedFrom = b.ships.find((s) => s.id === b.player.home);
  const deck = b.ships.find((s) => s.name === "USS Yorktown");
  assert.notEqual(deck, launchedFrom, "the diversion deck must not be the deck the player launched from");

  // Leave exactly one live friendly deck, then use the game's own H route rather than writing home.
  for (const s of b.ships) if (s.team === "us" && s.kind === "carrier" && s !== deck) s.deck = 0;
  const f = { x: Math.sin(deck.heading), z: -Math.cos(deck.heading) };
  const band = deck.deckHeight + FINAL.minClearance + 0.2;
  Object.assign(b.player, {
    x: deck.x - f.x * 500,
    y: band,
    z: deck.z - f.z * 500,
    heading: deck.heading,
    pitch: 0,
    roll: 0,
    speed: 60,
    vx: f.x * 60,
    vy: 0,
    vz: f.z * 60,
    gear: true,
    gearPos: 1,
    autopilot: false,
    landingAssist: null,
  });
  b.playerFlight.reset();
  assert.equal(b.goHome(), deck, "H must route to the surviving friendly deck");
  assert.equal(b.recoveryCarrier, deck, "the recovery carrier must be the diverted deck");
  // The band clears the diverted deck's gate; the launch deck is a different hull, astern of the
  // parked aircraft's own carrier, so it is outside its envelope as well.
  assert.equal(finalReady(b.player, deck), true, "the band must be inside the diverted deck's envelope");
  assert.equal(finalReady(b.player, launchedFrom), false, "and outside the launch deck's envelope");
  const a = b.approach();
  assert.equal(a.carrier, deck, "the cue line must describe the diverted deck");
  assert.equal(a.ready, true, "the cue must offer the diverted deck's final");
  assert.ok(a.cues.includes("READY FOR L"), `the cue must say READY FOR L, got ${a.cues.join(" · ")}`);
  assert.equal(b.assistRecovery(), true, "the diverted deck must accept L");
  assert.equal(b.player.landingAssist, deck.id, "the assisted final must be bound to the diverted deck");
  assert.equal(b.player.home, deck.id, "the diversion must move the aircraft's deck binding");

  let guard = 0;
  while (b.status === "playing" && !["arrest", "service"].includes(b.player.mode) && guard++ < 60 * 200) b.step(1 / 60, {});
  assert.ok(["arrest", "service"].includes(b.player.mode), `the diversion must touch down: ${b.player.mode} / ${b.reason}`);
  assert.equal(b.player.home, deck.id, "the aircraft must land on the diverted deck");

  guard = 0;
  while (b.status === "playing" && b.player.mode === "arrest" && guard++ < 60 * 60) b.step(1 / 60, {});
  assert.equal(b.player.mode, "service", "the diverted recovery must reach the deck crew");
  // Settle a few frames in the deck-crew state: this is where the aircraft is actually held on deck.
  for (let i = 0; i < 3 && b.status === "playing"; i += 1) b.step(1 / 60, {});
  const expected = deck.deckHeight + gearClearance(b.player);
  assert.ok(
    Math.abs(b.player.y - expected) < 0.5,
    `the aircraft must rest on ${deck.name}'s own ${deck.deckHeight} m deck: y ${b.player.y.toFixed(2)}, expected ${expected.toFixed(2)} ` +
      `(a fleet-wide 22.00 m would float it ${(22 - expected).toFixed(2)} m above the deck)`,
  );
  // FIX 1's basis: CV-5 now draws her sister hull, so her datum equals the launch deck's and the
  // old "below the taller launch deck" contrast cannot exist. The diversion still reads the diverted
  // ship's own corrected record: its 20.06 m datum, not the retired model's 12.54 m.
  assert.equal(deck.deckHeight, launchedFrom.deckHeight, "CV-5 now carries her sisters' datum");
  assert.equal(deck.deckHeight, 20.06, "the corrected Yorktown-class datum, not the retired model's 12.54 m");
  const local = {
    right: (b.player.x - deck.x) * Math.cos(deck.heading) + (b.player.z - deck.z) * Math.sin(deck.heading),
    forward: (b.player.x - deck.x) * Math.sin(deck.heading) - (b.player.z - deck.z) * Math.cos(deck.heading),
  };
  assert.ok(Math.abs(local.right) < deck.deckWidth / 2, `lateral ${local.right.toFixed(2)} m must sit inside ${deck.name}'s ${deck.deckWidth} m corridor`);
  assert.ok(Math.abs(local.forward) < deck.deckLength / 2, `${local.forward.toFixed(2)} m must sit on ${deck.name}'s ${deck.deckLength} m deck`);
  assert.equal(lineUpLimit(deck), deck.deckWidth / 2 + FINAL.lateralMargin, "the line-up limit must be read off the diverted deck's own width");
});

// ---------------------------------------------------------------------------------------------
// AC-6 — a deck that cannot take an aircraft refuses it, with a reason
// ---------------------------------------------------------------------------------------------

claim("AC-6 a deck that cannot take an aircraft refuses it with a readable reason", () => {
  const b = new Battle(SEED);
  const deck = b.ships.find((s) => s.kind === "carrier" && s.team === "us");
  const plane = { id: "test-plane", team: "us", home: deck.id, airframe: "sbd", hp: 100, maxHp: 100 };

  // A deck destroyed below the shared suspension threshold cannot take the aircraft...
  deck.deck = 0;
  b.refreshDeck(deck);
  assert.equal(b.recoverAircraft(deck, plane), false, "a deck out of action must refuse the recovery");
  assert.ok(
    typeof deck.recoverBlocked === "string" && deck.recoverBlocked.length > 0,
    `the refusal must carry a readable reason, got ${JSON.stringify(deck.recoverBlocked)}`,
  );

  // ...an occupied deck cannot either, and says so...
  deck.deck = 1;
  deck.deckState.occupiedUntil = b.time + 100;
  b.refreshDeck(deck);
  assert.equal(b.recoverAircraft(deck, plane), false, "an occupied deck must refuse the recovery");
  assert.ok(
    typeof deck.recoverBlocked === "string" && deck.recoverBlocked.length > 0,
    `an occupied deck's refusal must carry a readable reason, got ${JSON.stringify(deck.recoverBlocked)}`,
  );

  // ...and the same aircraft recovers once the deck can take it again.
  deck.deckState.occupiedUntil = 0;
  b.refreshDeck(deck);
  assert.equal(b.recoverAircraft(deck, plane), true, "the same aircraft must recover once the deck can take it");
  assert.equal(deck.recoverBlocked, null, "a successful recovery must clear the refusal reason");
});

console.log("");
if (failures.length) {
  console.log(`check-deck-agreement: ${failures.length} claim(s) FAILED`);
  for (const f of failures) console.log(`  - ${f.name}`);
  process.exitCode = 1;
} else {
  console.log("check-deck-agreement: pure-Battle geometry, the one recovery gate and diversion geometry all agree");
}
