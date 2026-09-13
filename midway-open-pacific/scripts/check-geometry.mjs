/**
 * Hull and deck geometry check (PRD-midway-asset-battle-integration AC-6).
 *
 * The defect this closes: `WorldView.sizeCarrier` used to write the simulation's ship dimensions
 * while building meshes, so a `Battle` did not know how big a hull was until a renderer existed, and
 * `length`/`width` meant the launch corridor on the player's carrier and the damage bounds on every
 * other ship. A single deck height fed approach guidance, wheel contact and the deck party.
 *
 * So this asserts, through the real `Battle` and with no `WorldView` anywhere: every ship carries
 * its catalog geometry from construction; carrier deck datums actually differ where the shipped
 * models differ; `finalReady` answers from the selected deck's own datum and corridor, including a
 * case a fleet-wide 20.06 m would get wrong; and constructing a `WorldView` changes no number.
 *
 * Run: node scripts/check-geometry.mjs
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundle = async (contents) => {
  const built = await build({
    stdin: { contents, loader: "ts", resolveDir: root },
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    write: false,
    logLevel: "silent",
  });
  return import(`data:text/javascript,${encodeURIComponent(built.outputFiles[0].text)}`);
};

const { Battle, SHIP_CLASSES, finalReady, FINAL, lineUpLimit, approach, onDeck, overHull } = await bundle(`
  export { Battle } from "./src/sim/battle.ts";
  export { SHIP_CLASSES } from "./src/sim/catalog.ts";
  export { finalReady, FINAL, lineUpLimit, approach } from "./src/sim/recovery.ts";
  export { onDeck, overHull } from "./src/sim/math.ts";
`);

// ---- 1 — a pure Battle already knows how big every ship is, and the numbers are the catalog's.
const b = new Battle();
assert.equal(b.ships.length, 17, "the fleet is still seventeen hulls");
for (const s of b.ships) {
  assert.ok(Number.isFinite(s.hullLength) && s.hullLength > 20, `${s.name}: hull length ${s.hullLength}`);
  assert.ok(Number.isFinite(s.hullBeam) && s.hullBeam > 5, `${s.name}: hull beam ${s.hullBeam}`);
  assert.ok(Number.isFinite(s.deckHeight) && s.deckHeight > 0, `${s.name}: deck datum ${s.deckHeight}`);
  assert.equal(s.length, undefined, `${s.name} still carries the ambiguous 'length' field`);
  assert.equal(s.width, undefined, `${s.name} still carries the ambiguous 'width' field`);
}
/** Every ship whose geometry comes from a measured GLB, and the class it comes from. */
const FROM_CATALOG = {
  "USS Yorktown": "yorktown",
  Kaga: "kaga",
  Soryu: "soryu",
  Hiryu: "hiryu",
  Tone: "tone",
  Chikuma: "tone",
  Arashi: "kagero",
  Nowaki: "kagero",
  "USS Hammann": "hammann",
  "I-168": "i168",
  "USS Nautilus": "nautilus",
};
for (const [name, classId] of Object.entries(FROM_CATALOG)) {
  const s = b.ships.find((x) => x.name === name);
  const cls = SHIP_CLASSES[classId];
  assert.ok(s, `${name} is missing from the fleet`);
  assert.equal(s.hullLength, cls.measuredLength, `${name} hull length is not ${classId}'s measured GLB`);
  assert.equal(s.hullBeam, cls.hullBeam, `${name} hull beam is not ${classId}'s reference`);
}
// The two Tone-class cruisers and the two Kagero-class destroyers share a class, and the imported
// hulls are nothing like the generic 112 x 13 m the record used to start with.
const tone = b.ships.find((s) => s.name === "Tone");
assert.equal(tone.hullLength, 201.6, "Tone is a 201.6 m cruiser, not a generic 112 m hull");
assert.equal(tone.hullLength, b.ships.find((s) => s.name === "Chikuma").hullLength, "sisters share a hull");

// ---- 2 — the corridor is a different rectangle from the hull, and only carriers have one.
for (const s of b.ships) {
  if (s.kind === "carrier") {
    assert.ok(s.deckLength > 100 && s.deckWidth > 10, `${s.name}: corridor ${s.deckLength}x${s.deckWidth}`);
    assert.ok(s.deckLength <= s.hullLength, `${s.name}: a corridor cannot be longer than the hull`);
    assert.ok(s.deckWidth <= s.hullBeam, `${s.name}: a corridor cannot be wider than the hull`);
  } else assert.deepEqual([s.deckLength, s.deckWidth], [0, 0], `${s.name} is not a carrier and has no corridor`);
}
const enterprise = b.ships.find((s) => s.name === "USS Enterprise");
assert.deepEqual(
  [enterprise.deckLength, enterprise.deckWidth, enterprise.hullLength, enterprise.hullBeam],
  [220, 20, 251.58, 32.4],
  "the surveyed 220x20 launch corridor sits inside the 251.58x32.4 hull",
);
// The two rectangles disagree about a point over the deck edge, which is the whole reason they are
// two fields: a bomb must hit there and an aircraft must not land there.
const edge = { x: enterprise.x + Math.cos(enterprise.heading) * 14, z: enterprise.z + Math.sin(enterprise.heading) * 14 };
assert.equal(overHull(edge, enterprise), true, "a point 14 m abeam is over the hull");
assert.equal(onDeck(edge, enterprise), false, "and is not inside the landing corridor");

// ---- 3 — per-carrier deck datums, and no single global height.
const decks = Object.fromEntries(b.ships.filter((s) => s.kind === "carrier").map((s) => [s.name, s.deckHeight]));
assert.deepEqual(
  decks,
  {
    "USS Enterprise": 20.06,
    "USS Hornet": 20.06,
    "USS Yorktown": 20.45,
    Akagi: 20.06,
    Kaga: 23.47,
    Soryu: 20.42,
    Hiryu: 20.6,
  },
  "carrier deck datums must be each ship's own measurement",
);
assert.equal(new Set(Object.values(decks)).size, 5, "five distinct deck datums, not one");
for (const file of ["src/sim/battle.ts", "src/sim/recovery.ts"]) {
  const source = readFileSync(resolve(root, file), "utf8");
  assert.ok(!/\bDECK_HEIGHT\b/.test(source), `${file} still reads the fleet-wide DECK_HEIGHT constant`);
}
// A weapon meets the deck it is aimed at: Kaga's hit plane is 3.41 m above Hornet's.
const bombOverKaga = (y) => {
  const battle = new Battle();
  const ship = battle.ships.find((s) => s.name === "Kaga");
  const before = ship.hp;
  battle.bombs.push({ id: battle.id("bomb"), x: ship.x, y, z: ship.z, vx: 0, vy: -120, vz: 0, team: "us", owner: "player", age: 0, damage: 40 });
  battle.updateWeapons(1 / 60);
  return ship.hp < before;
};
const kaga = b.ships.find((s) => s.name === "Kaga");
assert.equal(bombOverKaga(kaga.deckHeight + 1), true, "a bomb crossing Kaga's own deck plane hits it");
assert.equal(bombOverKaga(20.06 + 1), false, "and a bomb aimed at Hornet's deck height passes under Kaga's");

// ---- 4 — finalReady reads the selected deck's own datum and corridor.
/** Put the aircraft on the centreline astern of `s`, at absolute altitude `y` and offset `right`. */
const astern = (battle, s, y, right = 0, range = 400) => {
  const f = { x: Math.sin(s.heading), z: -Math.cos(s.heading) };
  Object.assign(battle.player, {
    x: s.x - f.x * range + Math.cos(s.heading) * right,
    z: s.z - f.z * range + Math.sin(s.heading) * right,
    y,
    heading: s.heading,
    speed: 60,
    mode: "flight",
    gear: true,
  });
  return battle.player;
};
const hornet = b.ships.find((s) => s.name === "USS Hornet");
const yorktown = b.ships.find((s) => s.name === "USS Yorktown");
assert.notEqual(hornet.deckHeight, yorktown.deckHeight, "this case needs two decks at different heights");

// The discriminating band: 24.2 m clears Hornet's deck by 4.14 m and Yorktown's by only 3.75 m, and
// the gate opens at 3.94 m. A fleet-wide 20.06 m datum would have called both of them ready.
const band = hornet.deckHeight + FINAL.minClearance + 0.2;
assert.equal(finalReady(astern(b, hornet, band), hornet), true, "ready over the lower deck");
assert.equal(finalReady(astern(b, yorktown, band), yorktown), false, "not yet ready over the taller deck");
assert.ok(band > 20.06 + FINAL.minClearance, "a fixed 20.06 m datum would have passed both — that is the bug");
assert.equal(
  finalReady(astern(b, yorktown, yorktown.deckHeight + FINAL.minClearance + 0.2), yorktown),
  true,
  "the same clearance over its own deck is ready",
);
// The cue the HUD prints and the gate the game enforces are the same decision, per deck.
for (const s of [hornet, yorktown]) {
  const low = approach(astern(b, s, band), s);
  assert.equal(low.ready, finalReady(b.player, s), `${s.name}: the cue and the gate disagree`);
  if (!low.ready) assert.ok(low.cues.includes("LOW"), `${s.name}: a sub-envelope approach must say LOW`);
}
// The line-up corridor is the deck's own width plus the LSO's tolerance, so the wider deck accepts
// a wider lineup — and neither accepts one beyond its own limit.
assert.ok(lineUpLimit(yorktown) > lineUpLimit(hornet), "a wider deck has a wider lineup limit");
for (const s of [hornet, yorktown]) {
  const inside = lineUpLimit(s) - 1;
  assert.equal(finalReady(astern(b, s, s.deckHeight + 20, inside), s), true, `${s.name}: inside its lineup limit`);
  assert.equal(finalReady(astern(b, s, s.deckHeight + 20, lineUpLimit(s) + 1), s), false, `${s.name}: beyond it`);
}
// A carrier with no deck geometry is refused outright rather than silently taking a default.
assert.throws(() => finalReady(astern(b, hornet, 40), { ...hornet, deckHeight: undefined }), /no deck datum/);

// ---- 5 — a diversion actually flies: the player recovers on a second deck, by the same gate.
{
  const home = new Battle();
  home.start(true);
  const deck = home.ships.find((s) => s.name === "USS Yorktown");
  home.ships.filter((s) => s.team === "us" && s.kind === "carrier" && s !== deck).forEach((s) => (s.deck = 0));
  const f = { x: Math.sin(deck.heading), z: -Math.cos(deck.heading) };
  Object.assign(home.player, {
    x: deck.x - f.x * 4500,
    y: 900,
    z: deck.z - f.z * 4500,
    heading: deck.heading,
    pitch: 0,
    roll: 0,
    speed: 100,
    vx: f.x * 100,
    vy: 0,
    vz: f.z * 100,
    autopilot: false,
    landingAssist: null,
  });
  home.playerFlight.reset();
  assert.equal(home.goHome(), deck, "the only live deck left is the diversion deck");
  let guard = 0;
  while (home.status === "playing" && !home.approach().ready && guard++ < 60 * 600) home.step(1 / 60, {});
  assert.equal(home.approach().ready, true, `the guided diversion reaches the gate: ${JSON.stringify(home.approach().cues)}`);
  assert.equal(home.assistRecovery(), true, "and the same gate accepts L");
  guard = 0;
  while (home.status === "playing" && home.player.mode === "flight" && guard++ < 60 * 200) home.step(1 / 60, {});
  assert.ok(["arrest", "service"].includes(home.player.mode), `it touches down on the diversion deck: ${home.player.mode} / ${home.reason}`);
  // Inside the corridor of the deck it actually landed on, at that deck's own datum.
  const local = {
    right: (home.player.x - deck.x) * Math.cos(deck.heading) + (home.player.z - deck.z) * Math.sin(deck.heading),
    forward: (home.player.x - deck.x) * Math.sin(deck.heading) - (home.player.z - deck.z) * Math.cos(deck.heading),
  };
  assert.ok(Math.abs(local.right) < deck.deckWidth / 2, `touchdown lateral ${local.right.toFixed(2)} m is inside the corridor`);
  assert.ok(Math.abs(local.forward) < deck.deckLength / 2, `touchdown ${local.forward.toFixed(2)} m is on the deck`);
  assert.ok(
    Math.abs(home.player.y - deck.deckHeight) < 2.2,
    `the wheels are on Yorktown's own deck: y ${home.player.y.toFixed(2)} against datum ${deck.deckHeight}`,
  );
  console.log(
    `check-geometry: recovered on ${deck.name} at ${local.forward.toFixed(1)} m / ${local.right.toFixed(2)} m, wheels ${home.player.y.toFixed(2)} m over a ${deck.deckHeight} m deck`,
  );
}

// ---- 6 — constructing a WorldView changes no simulation dimension.
const { WorldView } = await bundle(`export { WorldView } from "./src/render/world.ts";`);
const FIELDS = ["hullLength", "hullBeam", "deckLength", "deckWidth", "deckHeight"];
const snapshot = (battle) => battle.ships.map((s) => [s.name, ...FIELDS.map((k) => s[k])]);
const view = new Battle();
view.start();
const before = snapshot(view);
// A WorldView needs a scene, a camera and a renderer. Three.js does not run under node, so the view
// is exercised as far as its constructor and `reset` go: those are where the writes used to be.
let constructed = false;
try {
  const noop = () => undefined;
  const host = {
    scene: { add: noop, fog: null, background: null, environment: null },
    camera: { position: { set: noop }, lookAt: noop },
    renderer: { raw: { outputColorSpace: 0, shadowMap: {}, setPixelRatio: noop, domElement: {} } },
    add: noop,
  };
  const world = new WorldView(host, view);
  world.reset(view);
  constructed = true;
} catch (error) {
  // A Three.js failure is expected off-screen; the point is that nothing was written before it.
  assert.ok(error instanceof Error, "the view failed in an unexpected way");
}
assert.deepEqual(snapshot(view), before, "constructing a WorldView must not change a simulation dimension");
// Three.js cannot finish building a world under node, so the snapshot above cannot on its own prove
// that a full render pass writes nothing. No render module may assign to a geometry field at all.
const WRITE = /\.(?:hullLength|hullBeam|deckLength|deckWidth|deckHeight)\s*=[^=]/;
const renderFiles = readdirSync(resolve(root, "src/render")).filter((f) => f.endsWith(".ts"));
assert.ok(renderFiles.length > 10, `expected the render modules, found ${renderFiles.length}`);
for (const file of renderFiles) {
  const source = readFileSync(resolve(root, "src/render", file), "utf8");
  assert.ok(!WRITE.test(source), `src/render/${file} writes a simulation dimension; render reads geometry, never writes it`);
}
console.log(
  `check-geometry: WorldView wrote nothing back (constructor completed under node: ${constructed}); ${renderFiles.length} render modules assign no geometry field`,
);

// The renderer's own deck table must still agree with the simulation's, since the two are the same
// measurement of the same shipped models. This is a text check because the render module cannot be
// imported outside a browser; src/render/imported-ships.ts belongs to another lane.
const rendered = readFileSync(resolve(root, "src/render/imported-ships.ts"), "utf8");
for (const [name, height] of Object.entries(decks)) {
  const key = { "USS Enterprise": "enterprise", "USS Hornet": "hornet", "USS Yorktown": "yorktown" }[name] ?? name.toLowerCase();
  const row = new RegExp(`${key}: (?:deck\\("${key}", ${height}\\)|\\{[^}]*height: ${height}[^}]*\\})`);
  assert.ok(row.test(rendered), `src/render/imported-ships.ts DECKS.${key} must carry the ${height} m datum the simulation uses`);
}

console.log(`check-geometry: ${b.ships.length} hulls sized before any render; 5 distinct deck datums; all checks passed`);
