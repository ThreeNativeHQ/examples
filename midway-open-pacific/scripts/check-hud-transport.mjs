/**
 * HUD transport check. The native target runs `src/hud.ts` in the web view against a snapshot of
 * the battle instead of the battle itself, so this asserts the snapshot is the same thing after a
 * trip through JSON: every field the renderer reads still there, the computed answers unchanged,
 * the contact map rebuilt, the canvas projecting to the same pixel as `World.project`, and the
 * HUD-object state — the map flag, the latest toast, the debrief, the fps switch — landing once.
 *
 * `tsc` already proves the *shape* matches what `Hud` reads; this proves the *values* survive.
 *
 * Uses the esbuild vite already installs. Run: node scripts/check-hud-transport.mjs
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { build } from "esbuild";
import * as T from "three";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const built = await build({
  stdin: {
    contents:
      'export * from "./src/ui/state.ts";\nexport { createUiBridge } from "./src/ui/bridge.ts";\nexport { Battle } from "./src/sim/battle.ts";\nexport { Midway } from "./src/scenes/Midway.ts";\nexport { setShell } from "./src/ui/port.ts";',
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
const {
  Battle,
  Midway,
  applyHudSnapshot,
  createHudMemory,
  createSnapshotView,
  createUiBridge,
  fromHudSnapshot,
  setShell,
  toHudSnapshot,
} = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);

/** A camera pointed down the deck from behind the aircraft, and the viewport it fills. */
function stubView(battle) {
  const camera = new T.PerspectiveCamera(57, 1600 / 900, 0.6, 95000);
  const p = battle.player;
  camera.position.set(p.x - 40, p.y + 25, p.z + 90);
  camera.lookAt(p.x, p.y, p.z);
  camera.updateMatrixWorld(true);
  const clip = new T.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const snapshot = { cameraMode: 2, followBomb: false, height: 900, matrix: [...clip.elements], width: 1600 };
  const tmp = new T.Vector3();
  return {
    camera,
    cameraMode: snapshot.cameraMode,
    followBomb: snapshot.followBomb,
    /** `World.project`, verbatim, as the reference the snapshot view has to reproduce. */
    project(q) {
      const v = tmp.set(q.x, q.y || 0, q.z).project(camera);
      return {
        depth: v.z,
        visible: v.z > -1 && v.z < 1 && Math.abs(v.x) < 1.15 && Math.abs(v.y) < 1.15,
        x: (v.x * 0.5 + 0.5) * snapshot.width,
        y: (-0.5 * v.y + 0.5) * snapshot.height,
      };
    },
    viewSnapshot: () => snapshot,
  };
}

const battle = new Battle(19420604);
battle.start(true);
// Far enough in for contacts to be delivered, the radio to have spoken and a sortie to be running.
for (let i = 0; i < 6000; i++) battle.step(1 / 60, {});
battle.target = [...battle.contacts.keys()][0] ?? null;
const view = stubView(battle);

/** Idle HUD-object state: nothing assigned, no event fired. */
const uiIdle = {
  mapOpen: false,
  hitFlash: 0,
  hitSeq: 0,
  lastRadio: "",
  lastContacts: "",
  lastBattleStatus: "",
  radioSeq: 0,
  contactsSeq: 0,
  statusSeq: 0,
  toastText: "",
  toastSeq: 0,
  debriefSeq: 0,
  fpsOn: false,
  elapsed: 0,
  updateSpeed: 1,
};

const snapshot = toHudSnapshot(battle, view, { ...uiIdle, mapOpen: true, hitFlash: 0.75, toastText: "TORPEDO AWAY", toastSeq: 3 }, 7);
const json = JSON.stringify(snapshot);
const wire = JSON.parse(json);

// 1. Nothing is lost in transit. A `Map`, a class instance or an `undefined` in a required field
//    would all survive `toHudSnapshot` and quietly differ here.
assert.equal(JSON.stringify(wire), json, "the snapshot is not JSON round-trippable");
assert.equal(json.includes('"[object Object]"'), false, "a value stringified to a placeholder");
// A native state sample is validated JSON-safe and `JSON.stringify` drops `undefined` keys, so an
// undefined would vanish from the renderer's copy while looking fine on the wire. Walk it.
const undefinedPaths = [];
(function walk(value, path) {
  if (value === undefined) undefinedPaths.push(path);
  else if (Array.isArray(value)) value.forEach((item, index) => walk(item, `${path}[${index}]`));
  else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) walk(item, `${path}.${key}`);
  }
})(snapshot, "$");
assert.deepEqual(undefinedPaths, [], `undefined values do not survive the snapshot: ${undefinedPaths.slice(0, 8).join(", ")}`);
for (const [key, value] of Object.entries(snapshot.battle)) {
  assert.notEqual(value, undefined, `battle.${key} is undefined`);
  assert.ok(key in wire.battle, `battle.${key} did not cross`);
}
for (const [key, value] of Object.entries(snapshot.battle.player)) {
  assert.equal(Number.isNaN(value), false, `player.${key} is NaN`);
}
assert.equal(snapshot.seq, 7);
assert.equal(typeof snapshot.session, "number", "the HUD session id did not cross");
assert.equal(wire.mapOpen, true, "the map flag did not cross");
assert.equal(wire.hitFlash, 0.75, "hitFlash did not cross");
assert.equal(wire.hitSeq, 0, "the hit stamp did not cross");
assert.equal(wire.toastText, "TORPEDO AWAY", "the toast did not cross");
assert.equal(wire.toastSeq, 3, "the toast sequence did not cross");

// 2. No simulation internals ride along. These sit on the same records the HUD reads from.
for (const banned of ["gunnerPrevAutopilot", "takeoffGrace", "gunTimer", "heat", "autoGearPending"]) {
  assert.equal(banned in wire.battle.player, false, `player.${banned} leaked into the snapshot`);
}
assert.equal(typeof wire.battle.computed.approach.carrier, "boolean", "the approach carrier crossed as an object");

// 3. The battle the renderer reads answers the way the live one did.
const mirror = fromHudSnapshot(wire.battle);
assert.ok(mirror.contacts instanceof Map, "contacts did not come back as a Map");
assert.deepEqual([...mirror.contacts.keys()], [...battle.contacts.keys()], "the contact map changed");
assert.equal(mirror.contacts.size > 0, true, "no contacts to carry — the fixture never found anything");
assert.equal(mirror.wingStatus(), battle.wingStatus());
assert.equal(mirror.canAccelerate(), battle.canAccelerate());
assert.deepEqual(mirror.battleStatus(), battle.battleStatus());
assert.deepEqual(mirror.replacementStatus(), battle.replacementStatus());
assert.deepEqual(mirror.returnReserve(), battle.returnReserve());
assert.equal(mirror.targetContacts().length, battle.targetContacts().length);
assert.equal(mirror.approach().phase, battle.approach().phase);
assert.equal(mirror.approach().carrier, Boolean(battle.approach().carrier));

// 4. The map and the debrief read these, and they are the fields a partial copy loses first.
assert.equal(mirror.ships.length, battle.ships.length, "the map lost hulls");
for (const key of ["id", "name", "kind", "sunk", "deck", "fire", "heading", "x", "z"]) {
  assert.ok(key in mirror.ships[0], `ships[].${key} is missing — the map draws with it`);
}
assert.equal(mirror.sortie.assignment, battle.sortie.assignment);
assert.deepEqual(mirror.sortie.pending, battle.sortie.pending);
assert.deepEqual(mirror.stats, { kills: battle.stats.kills, shipHits: battle.stats.shipHits, sorties: battle.stats.sorties });
assert.equal(Array.isArray(mirror.wrecks), true);
assert.equal(mirror.radio.length, battle.radio.length, "the radio log lost lines");
if (mirror.radio.length > 0) {
  for (const key of ["id", "from", "text", "time", "priority"]) assert.ok(key in mirror.radio[0], `radio[].${key} is missing`);
}

// A frozen debrief result is the one record written once and read long after; carry it as it stands.
battle.sortie.result = {
  assignment: "strike",
  carrier: "USS ENTERPRISE",
  damage: ["AILERON", "FUEL"],
  elapsed: 612.5,
  fuel: 41.2,
  hp: 63,
  nearMisses: 1,
  objective: true,
  outcome: "recovered",
  personalHits: 2,
  reportedCarriers: 1,
  wingHits: 1,
};
const debrief = fromHudSnapshot(JSON.parse(JSON.stringify(toHudSnapshot(battle, view, uiIdle, 8))).battle);
assert.deepEqual(debrief.sortie.result, battle.sortie.result, "the debrief result did not cross");

// 5. The canvas projects to the same pixel it does on the web, behind the camera included.
const projected = createSnapshotView(wire.view);
assert.equal(projected.cameraMode, 2);
assert.equal(projected.followBomb, false);
const p = battle.player;
const probes = [
  { x: p.x, y: p.y, z: p.z },
  { x: p.x + 1600, y: p.y + 40, z: p.z - 1600 },
  { x: p.x, y: p.y, z: p.z + 4000 },
  { x: battle.ships[0].x, z: battle.ships[0].z },
  { x: p.x - 250, y: 0, z: p.z - 250 },
];
for (const probe of probes) {
  const want = view.project(probe);
  const got = projected.project(probe);
  assert.ok(Math.abs(want.x - got.x) < 1e-6, `x ${want.x} vs ${got.x}`);
  assert.ok(Math.abs(want.y - got.y) < 1e-6, `y ${want.y} vs ${got.y}`);
  assert.ok(Math.abs(want.depth - got.depth) < 1e-9, `depth ${want.depth} vs ${got.depth}`);
  assert.equal(want.visible, got.visible, `visibility disagrees at ${JSON.stringify(probe)}`);
}
// `apply` re-aims the object the HUD already holds, so a new camera reaches it without a new HUD.
const moved = { ...wire.view, cameraMode: 0, width: 800 };
projected.apply(moved);
assert.equal(projected.cameraMode, 0);
assert.ok(Math.abs(projected.project(probes[0]).x - view.project(probes[0]).x / 2) < 1e-6, "apply did not re-aim the view");

// 6. Coalescing keeps the newest complete state, and a repeated snapshot never re-fires.
//    Two commands plus a tick publish before one imagined flush; the store keeps only the last
//    staged patch (a newer complete snapshot supersedes the older one), and the web view applies
//    that patch twice — as React does when the unrelated `ui` half changes.
const staged = [];
const uiBridge = createUiBridge((patch) => staged.push(JSON.parse(JSON.stringify(patch))));
const bridgeHud = uiBridge.shell.hud(battle, view);
bridgeHud.toast("FIRST");
bridgeHud.toast("SECOND");
bridgeHud.mapOpen = true;
bridgeHud.debrief();
bridgeHud.toggleFps();
bridgeHud.update(0.12);
assert.ok(staged.length > 1, "the bridge should publish per command, coalesced by the store");
const lastHud = staged[staged.length - 1].hud;
assert.equal(lastHud.toastText, "SECOND", "coalescing lost the newest toast");
assert.equal(lastHud.toastSeq, 2, "coalescing lost the toast count");
assert.equal(lastHud.mapOpen, true, "coalescing lost the map flag");
assert.equal(lastHud.debriefSeq, 1, "coalescing lost the debrief");
assert.equal(lastHud.fpsOn, true, "coalescing lost the fps switch");
assert.ok(lastHud.seq > 1, "the snapshot sequence did not advance");

const seen = [];
const stub = {
  b: null,
  mapItems: [],
  mapOpen: false,
  hitFlash: 0,
  lastRadio: "seed",
  lastContacts: "seed",
  lastBattleStatus: "seed",
  toast: (t) => seen.push(["toast", t]),
  update: (dt, speed) => seen.push(["update", dt, speed]),
  draw: () => seen.push(["draw"]),
  debrief: () => seen.push(["debrief"]),
  drawMap: () => seen.push(["drawMap"]),
  updateContactList: () => seen.push(["updateContactList"]),
  updateBattleStatus: () => seen.push(["updateBattleStatus"]),
  toggleFps: () => seen.push(["toggleFps"]),
};
const mem = createHudMemory();
applyHudSnapshot(stub, lastHud, mem);
applyHudSnapshot(stub, lastHud, mem);
assert.equal(stub.mapOpen, true, "the map flag did not reach the HUD");
const toasts = seen.filter(([k]) => k === "toast");
assert.deepEqual(toasts, [["toast", "SECOND"]], "the toast fired twice, never, or with the stale text");
assert.equal(seen.filter(([k]) => k === "debrief").length, 1, "the debrief fired twice or never");
assert.equal(seen.filter(([k]) => k === "toggleFps").length, 1, "the fps switch flipped twice or never");
assert.equal(seen.filter(([k]) => k === "update").length, 1, "the tick ran twice or never");
assert.equal(seen.filter(([k]) => k === "draw").length, 1, "the repaint ran twice or never");
// A newer snapshot still lands afterwards: the guard drops repeats, not updates.
bridgeHud.toast("THIRD");
const nextHud = staged[staged.length - 1].hud;
applyHudSnapshot(stub, nextHud, mem);
assert.deepEqual(
  seen.filter(([k]) => k === "toast"),
  [["toast", "SECOND"], ["toast", "THIRD"]],
  "a newer toast after a repeat did not land",
);

// 7. hitFlash is an event stamped by hitSeq, never a level and never cleared after a publish.
//    A hit followed by a tick before a single flush must survive coalescing, the decay the web
//    view owns must not be re-raised, and a second hit must land as its own stamp.
const hitBridge = uiBridge.shell.hud(battle, view);
hitBridge.hitFlash = 1;
hitBridge.update(0.12); // stage a snapshot carrying the hit...
hitBridge.update(0.12); // ...then a later tick overwrites it before any store flush
const hit = staged[staged.length - 1].hud; // the store keeps only the newest
assert.equal(hit.hitFlash, 1, "the hit was lost when a later tick overwrote the staged snapshot");
assert.equal(hit.hitSeq, 1, "the hit was not stamped");
hitBridge.update(0.12); // a later snapshot of the same hit
assert.equal(staged[staged.length - 1].hud.hitFlash, 1, "the hit level is persistent state");
const flashMem = createHudMemory();
const decaying = { ...stub, hitFlash: 0 };
applyHudSnapshot(decaying, hit, flashMem);
assert.equal(decaying.hitFlash, 1, "a stamped hit did not raise the flash");
decaying.hitFlash = 0.4; // the live HUD decays it
applyHudSnapshot(decaying, { ...hit, seq: hit.seq + 1 }, flashMem);
assert.equal(decaying.hitFlash, 0.4, "a later snapshot re-raised a decaying flash");
applyHudSnapshot(decaying, hit, flashMem);
assert.equal(decaying.hitFlash, 0.4, "a repeated snapshot re-applied the same hit");
hitBridge.hitFlash = 1; // a second hit
hitBridge.update(0.12);
const hit2 = staged[staged.length - 1].hud;
assert.equal(hit2.hitSeq, 2, "the second hit was not stamped");
applyHudSnapshot(decaying, hit2, flashMem);
assert.equal(decaying.hitFlash, 1, "the second hit did not raise the flash");

// 8. A replaced HUD carries a new session id, so its first events are not dropped behind the
//    old HUD's counters. The first bridge published session 1; this second one must land its
//    own toast and debrief with memory that already saw session 1.
const second = uiBridge.shell.hud(battle, view);
const seen2 = [];
const stub2 = {
  ...stub,
  toast: (t) => seen2.push(["toast", t]),
  debrief: () => seen2.push(["debrief"]),
};
const mem2 = createHudMemory();
applyHudSnapshot(stub2, staged[staged.length - 1].hud, mem2);
seen2.length = 0;
second.toast("NEW SESSION");
second.debrief();
const replaced = staged[staged.length - 1].hud;
assert.notEqual(replaced.session, staged[0].hud.session, "a replaced HUD reused the session id");
applyHudSnapshot(stub2, replaced, mem2);
assert.deepEqual(
  seen2.filter(([k]) => k === "toast"),
  [["toast", "NEW SESSION"]],
  "the replaced HUD's first toast was dropped",
);
assert.equal(seen2.filter(([k]) => k === "debrief").length, 1, "the replaced HUD's first debrief was dropped");
// The replacement's own hit stamp must land too, against memory that saw the first HUD's hits.
stub2.hitFlash = 0.7; // pretend the old HUD was mid-decay
second.hitFlash = 1;
second.update(0.12);
const replacedHit = staged[staged.length - 1].hud;
assert.equal(replacedHit.hitSeq, 1, "the replaced HUD's hit stamp did not restart");
applyHudSnapshot(stub2, replacedHit, mem2);
assert.equal(stub2.hitFlash, 1, "the replaced HUD's first hit was dropped behind the old stamp");

// 9. `elapsed` is a cumulative total of live HUD seconds, and the web view applies only its
//    increase. The web view's `Hud.update` decays the flash and advances its 0.1s DOM tick with the
//    dt it receives, so the total must grow by real time once and never be replayed.
//
// 9a. Accumulation still happens below the publish threshold: three 0.04s ticks publish one total.
const tickBridge = uiBridge.shell.hud(battle, view);
tickBridge.update(0.04);
tickBridge.update(0.04); // still below the 0.1s publish threshold
const beforeTick = staged.length;
tickBridge.update(0.04); // crosses it
assert.ok(staged.length > beforeTick, "an accumulated 0.1s tick was never published");
const elapsed = staged[staged.length - 1].hud.elapsed;
assert.ok(Math.abs(elapsed - 0.12) < 1e-9, `elapsed must be accumulated time, got ${elapsed}`);

// 9b. A non-tick publish between two ticks repeats the total and must not replay the interval.
//     Old contract: each snapshot carried its own `updateDt`, so the toast applied 0.12 a third
//     time. New contract: the delta is zero, and the next tick contributes exactly its own 0.12.
const seqBridge = uiBridge.shell.hud(battle, view); // a fresh total, so the deltas are unambiguous
const tickMem = createHudMemory();
const tickSeen = [];
const tickStub = { ...stub, update: (dt) => tickSeen.push(dt) };
seqBridge.update(0.12);
const tickA = staged[staged.length - 1].hud;
seqBridge.toast("MID-TICK"); // an event publish, same elapsed total
const tickB = staged[staged.length - 1].hud;
seqBridge.update(0.12);
const tickC = staged[staged.length - 1].hud;
applyHudSnapshot(tickStub, tickA, tickMem);
applyHudSnapshot(tickStub, tickB, tickMem);
applyHudSnapshot(tickStub, tickC, tickMem);
assert.deepEqual(tickSeen, [0.12, 0.12], "an event snapshot replayed the tick interval or the next tick was lost");

// 9c. Several tick publishes coalesced before one delivery keep their whole interval: the newest
//     total already contains the ones the store dropped, and the consumer applies it once.
const coalBridge = uiBridge.shell.hud(battle, view);
const coalMem = createHudMemory();
const coalSeen = [];
const coalStub = { ...stub, update: (dt) => coalSeen.push(dt) };
coalBridge.update(0.12);
applyHudSnapshot(coalStub, staged[staged.length - 1].hud, coalMem);
coalBridge.update(0.12);
coalBridge.update(0.12); // staged, then overwritten before the flush — never delivered
const coal = staged[staged.length - 1].hud;
assert.ok(Math.abs(coal.elapsed - 0.36) < 1e-9, `the coalesced total must be 0.36, got ${coal.elapsed}`);
applyHudSnapshot(coalStub, coal, coalMem);
assert.equal(coalSeen.length, 2, "a coalesced snapshot was applied more or less than once");
const coalTotal = coalSeen.reduce((a, b) => a + b, 0);
assert.ok(Math.abs(coalTotal - 0.36) < 1e-9, `coalescing lost or double-counted elapsed: total ${coalTotal}`);

// 9d. A replacement HUD restarts its total at zero, so the memory's baseline resets with it rather
//     than clipping the new session's first intervals against the old one's total.
const replMem = createHudMemory();
const replSeen = [];
const replStub = { ...stub, update: (dt) => replSeen.push(dt) };
const replA = uiBridge.shell.hud(battle, view);
replA.update(0.12);
applyHudSnapshot(replStub, staged[staged.length - 1].hud, replMem); // old session, elapsed 0.12
const replB = uiBridge.shell.hud(battle, view);
replB.update(0.12);
replB.update(0.12); // new session reaches 0.24 before its first delivery
applyHudSnapshot(replStub, staged[staged.length - 1].hud, replMem);
assert.equal(replSeen.length, 2, "the replacement HUD's first interval did not land");
assert.ok(Math.abs(replSeen[0] - 0.12) < 1e-9, `the first session's interval was ${replSeen[0]}`);
assert.ok(Math.abs(replSeen[1] - 0.24) < 1e-9, `the replacement session's interval was clipped by the old baseline: ${replSeen[1]}`);

// 10. A replaced HUD keeps tracking the display's fps overlay: memory must not snap `fpsOn` to the
//     new session's default, or an overlay left on by the old HUD is never switched off.
const fpsBridge = uiBridge.shell.hud(battle, view);
const fpsSeen = [];
const fpsStub = { ...stub, toggleFps: () => fpsSeen.push("fps") };
const fpsMem = createHudMemory();
fpsBridge.toggleFps();
applyHudSnapshot(fpsStub, staged[staged.length - 1].hud, fpsMem);
assert.equal(fpsSeen.length, 1, "the fps toggle did not reach the HUD");
const newer = uiBridge.shell.hud(battle, view); // new session, its own fpsOn defaults to false
newer.update(0.12);
applyHudSnapshot(fpsStub, staged[staged.length - 1].hud, fpsMem);
assert.equal(fpsSeen.length, 2, "a new HUD session left the fps overlay switched on from the old one");

// 11. The terminal debrief dialog stays visible on native. This drives the SCENE'S REAL terminal
//     transition — `Midway.update` on a battle that has reached the debrief status — through the
//     bridge the native entry installs, then replays the published `ui` half the way
//     `src/ui/main.tsx` does on every cross-process snapshot (a fresh JSON object each time). The
//     scene's `hud.debrief()` alone only touches the hud channel; the dialog's visibility lives on
//     `ui.screens`, and removing the scene's own `shell.screen("debrief", true)` call at the
//     transition must make this fail.
const sceneStaged = [];
const sceneBridge = createUiBridge((patch) => sceneStaged.push(JSON.parse(JSON.stringify(patch))));
setShell(sceneBridge.shell);
// A scene reaching its terminal tick, with only the collaborators `update` touches.
const terminal = Object.create(Midway.prototype);
terminal.battle = {
  status: "debrief",
  player: { mode: "service", gunner: false },
  ships: [],
  aircraft: [],
  island: null,
  events: [],
  canAccelerate: () => false,
};
terminal.world = {
  update() {},
  cockpitView: false,
  cameraMode: 0,
  followBomb: false,
  rear: false,
  lookActive: false,
  lookYaw: 0,
  lookPitch: 0,
  meshes: new Map(),
  playerMesh: null,
  camera: { getWorldPosition: (v) => v },
  reset() {},
  setCamera() {},
};
terminal.hud = sceneBridge.shell.hud(battle, view);
terminal.audio = { update() {}, syncEmitters() {}, event() {}, start() {} };
terminal.ctx = {
  input: {
    justPressed: () => false,
    releaseMouse() {},
    captureMouse() {},
    raw: { pointer: { buttons: 0, captured: false, position: { x: 0, y: 0 } }, keys: new Set() },
  },
  state: { set() {}, flush() {} },
};
terminal.wall = 0;
terminal.ended = false;
terminal.paused = false;
terminal.crashCam = false;
terminal.wasCaptured = false;
terminal.mouseState = { fire: false, looking: false, lockClick: false, lx: 0, ly: 0 };
terminal.publishTick = 1;
terminal.camPos = new T.Vector3();
terminal.assignment = "strike";
terminal.nextAlbatross = 0;

const sceneScreens = { briefing: false, debrief: false, flight: false, loading: false };
/** The native entry's replay: each fresh `ui` value re-applies the whole screens map. */
function replaySceneUi() {
  const ui = sceneStaged.filter((p) => p.ui).pop()?.ui;
  if (ui === undefined) return;
  for (const [name, visible] of Object.entries(ui.screens)) sceneScreens[name] = visible;
}

terminal.update(undefined, 1 / 60);
replaySceneUi();
assert.equal(sceneScreens.debrief, true, "the scene's terminal transition did not publish the debrief dialog");
// Later, unrelated publications must not carry a stale false: the 10 Hz hud tick and a cockpit
// change each cross as their own fresh JSON snapshot and the consumer re-applies screens anyway.
terminal.hud.update(0.12);
sceneBridge.shell.cockpitView(true);
replaySceneUi();
assert.equal(sceneScreens.debrief, true, "a later snapshot re-hid the debrief dialog");
// The scene's own restart publishes the explicit false.
terminal.restartToBriefing();
replaySceneUi();
assert.equal(sceneScreens.debrief, false, "restart did not hide the debrief dialog");

// 12. The three repaint caches — `lastRadio`, `lastContacts`, `lastBattleStatus` — are
//     invalidations the scene raises, not values the bridge knows. The web view's `Hud` computes
//     the real key and rewrites the DOM only when it changes (hud.ts:236, 312, 931); the bridge
//     never computes one, so a snapshot must not cross "" over that key on every publish. If it
//     does, the contact list and radio log are rebuilt ~8.5x/s while the map is open — destroying
//     keyboard and AT focus before a contact can be activated. An explicit scene assignment must
//     land exactly once, two coalesced into one delivered snapshot must survive, and a replaced HUD
//     must not inherit the previous session's key memory.
const cacheRebuilds = { radio: 0, contacts: 0, status: 0 };
const cacheStub = {
  ...stub,
  // The same key `src/hud.ts` derives, and the same rewrite-only-on-change it performs.
  update() {
    const radioKey = this.b.radio.filter((r) => this.b.time - r.time < 23).slice(0, 2).map((r) => r.id).join();
    if (radioKey !== this.lastRadio) { this.lastRadio = radioKey; cacheRebuilds.radio += 1; }
    const contacts = this.b.targetContacts();
    const contactKey = contacts.map((c) => c.id + Math.floor((this.b.time - c.time) / 5)).join() + this.b.target;
    if (contactKey !== this.lastContacts) { this.lastContacts = contactKey; cacheRebuilds.contacts += 1; }
    const s = this.b.battleStatus();
    const statusKey = `${s.appraisal}|${s.friendlyOperational}|${s.friendlySunk}|${s.enemyReported}|${s.enemyDecksOut}|${s.airLosses}|${s.airKills}`;
    if (statusKey !== this.lastBattleStatus) { this.lastBattleStatus = statusKey; cacheRebuilds.status += 1; }
  },
};
const liveCache = uiBridge.shell.hud(battle, view);
const cacheMem = createHudMemory();
/** Every snapshot crosses the process boundary as bytes, exactly as the store delivers it. */
const wireHud = () => JSON.parse(JSON.stringify(staged[staged.length - 1].hud));

liveCache.update(0.12);
applyHudSnapshot(cacheStub, wireHud(), cacheMem);
const cacheBase = { ...cacheRebuilds };
assert.ok(cacheBase.radio > 0 && cacheBase.contacts > 0 && cacheBase.status > 0, "the first snapshot did not populate the repaint caches");

// A newer snapshot with the same derived keys is steady state, not an invalidation.
liveCache.update(0.12);
applyHudSnapshot(cacheStub, wireHud(), cacheMem);
assert.deepEqual(cacheRebuilds, cacheBase, "a newer snapshot with unchanged keys rebuilt a repaint cache");

// An explicit assignment is an invalidation, and it clears each cache exactly once...
liveCache.lastRadio = "";
liveCache.lastContacts = "";
liveCache.lastBattleStatus = "";
liveCache.update(0.12);
applyHudSnapshot(cacheStub, wireHud(), cacheMem);
assert.deepEqual(
  cacheRebuilds,
  { radio: cacheBase.radio + 1, contacts: cacheBase.contacts + 1, status: cacheBase.status + 1 },
  "an explicit invalidation did not rebuild each cache exactly once",
);
// ...and the next steady snapshot must not rebuild again.
liveCache.update(0.12);
applyHudSnapshot(cacheStub, wireHud(), cacheMem);
assert.deepEqual(
  cacheRebuilds,
  { radio: cacheBase.radio + 1, contacts: cacheBase.contacts + 1, status: cacheBase.status + 1 },
  "a consumed invalidation fired again on the next snapshot",
);

// Two invalidations coalesced into one delivered snapshot are one repaint, not lost and not two.
liveCache.lastContacts = "";
liveCache.lastContacts = "";
liveCache.update(0.12);
applyHudSnapshot(cacheStub, wireHud(), cacheMem);
assert.equal(cacheRebuilds.contacts, cacheBase.contacts + 2, "a coalesced invalidation was lost or double-fired");

// A replaced HUD must force exactly one rebuild even though its derived contact key is unchanged:
// its own stamps restart at zero, and only a memory reset below zero lets that first snapshot
// invalidate the display's cached key. Do not seed a stale string here — it would differ from the
// real key and rebuild for the wrong reason, hiding a broken reset.
const cachedContactKey = cacheStub.lastContacts;
assert.notEqual(cachedContactKey, "", "the contact cache was never populated");
const replacement = uiBridge.shell.hud(battle, view);
replacement.update(0.12);
const replacedSnap = wireHud();
assert.notEqual(replacedSnap.session, cacheMem.session, "a replaced HUD reused the session id");
applyHudSnapshot(cacheStub, replacedSnap, cacheMem);
assert.equal(cacheRebuilds.contacts, cacheBase.contacts + 3, "the fresh session's first snapshot did not rebuild the contact cache");
assert.equal(cacheStub.lastContacts, cachedContactKey, "the replacement re-derived a different contact key — the battle moved");

// 13. Enter is not a second "take the deck" button. The briefing's primary button is the real UI's
//     `begin` intent; a stray Enter while the assignment dropdown has focus must not launch the
//     sortie. This drives the scene's real `Midway.prototype.action`, so the assertions are about
//     the method's behavior, not a text match on its source.
{
  const actionScene = Object.create(Midway.prototype);
  actionScene.overlay = null;
  actionScene.paused = false;
  actionScene.battle = { status: "briefing", player: { mode: "deck", gunner: false } };
  let beginCalls = 0;
  let takeAircraftCalls = 0;
  actionScene.begin = () => { beginCalls += 1; };
  actionScene.takeAnotherAircraft = () => { takeAircraftCalls += 1; };

  actionScene.action("Enter");
  assert.equal(beginCalls, 0, "Enter during the briefing launched the sortie — only the real begin intent may");
  assert.equal(takeAircraftCalls, 0, "Enter during the briefing took an aircraft");

  // The real UI's begin intent is the authoritative launch path, and it still reaches `begin`.
  actionScene.intent({ kind: "begin", airborne: false, fresh: false });
  assert.equal(beginCalls, 1, "the UI begin intent no longer launches the sortie");

  // The downed replacement shortcut is legitimate existing behavior and stays: with no aircraft,
  // Enter is the only order that lands.
  actionScene.battle.status = "playing";
  actionScene.battle.player.mode = "downed";
  actionScene.action("Enter");
  assert.equal(takeAircraftCalls, 1, "Enter on a downed pilot no longer takes another aircraft");
}

const bytes = Buffer.byteLength(json);
assert.ok(bytes < 262144, `a snapshot is ${bytes} bytes; ten a second is too much to publish`);
console.log(`check-hud-transport: OK — ${bytes} B/snapshot, ${mirror.contacts.size} contacts, ${mirror.ships.length} hulls, ${probes.length} projections exact`);
