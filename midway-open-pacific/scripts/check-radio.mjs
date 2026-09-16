/**
 * Friendly-radio trigger check. Runs the real `Battle` (pure sim, no browser) against deterministic
 * setups, so the alert predicates are proven where they are produced: an active Zero on Enterprise
 * speaks R06, a Zero that has broken off does not, release speaks R17, and a routine line does not
 * repeat inside its cooldown.
 *
 * Uses the esbuild vite already installs. Run: node scripts/check-radio.mjs
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const built = await build({
  stdin: { contents: 'export { Battle } from "./src/sim/battle.ts"; export * from "./src/sim/radio-script.ts";', loader: "ts", resolveDir: root },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  write: false,
  logLevel: "silent",
});
const { Battle, resolveSpeech, radioShipName, speechSlugList, SPEECH } = await import(`data:text/javascript,${encodeURIComponent(built.outputFiles[0].text)}`);

const speechIds = (b) => b.events.filter((e) => e.type === "speech").map((e) => e.request.id);
const freshBattle = () => {
  const b = new Battle();
  b.status = "playing";
  b.time = 5;
  return b;
};
const zero = (over) => ({ id: "z1", kind: "fighter", airframe: "zero", team: "jp", hp: 100, mode: "flight", tactic: "intercept", x: 0, y: 120, z: 7000, vx: 0, vy: 0, vz: 0, ...over });

// 1 — the resolver keeps the exact words and resolves the ship/PA channels.
{
  assert.equal(resolveSpeech({ id: "R02", direction: "north" }).text, "Scout Three to Enterprise. Enemy aircraft sighted to the north of our task force.");
  assert.equal(resolveSpeech({ id: "R12", ship: "Akagi" }).slug, "r12-akagi");
  assert.equal(resolveSpeech({ id: "P05" }).channel, "pa");
  assert.equal(radioShipName("USS Enterprise"), "Enterprise", "USS prefix should normalize to the scripted name");
}

// 2 — an active Zero strafing Enterprise speaks R06; no jp aircraft means no R06.
{
  const quiet = freshBattle();
  quiet.updateRadio();
  assert.ok(!speechIds(quiet).includes("R06"), "R06 fired with no attacker");
  const b = freshBattle();
  b.aircraft.push(zero({}));
  b.updateRadio();
  assert.ok(speechIds(b).includes("R06"), "an active Zero on Enterprise did not raise R06");
  const line = b.radio.find((r) => r.from === "ENTERPRISE" && r.text.startsWith("Enterprise to all fighters. Zeros are strafing"));
  assert.ok(line, "R06 caption missing or misworded");
}

// 3 — a Zero that has broken off, or is destroyed, does not speak R06.
{
  const away = freshBattle();
  away.aircraft.push(zero({ tactic: "rtb" }));
  away.updateRadio();
  assert.ok(!speechIds(away).includes("R06"), "a Zero that broke off still raised R06");
  const dead = freshBattle();
  dead.aircraft.push(zero({ hp: 0 }));
  dead.updateRadio();
  assert.ok(!speechIds(dead).includes("R06"), "a destroyed Zero still raised R06");
}

// 4 — an active dive-bombing run and a torpedo run raise R07 and R08 against a named target.
{
  const enterprise = (b) => b.ships.find((s) => s.team === "us" && s.kind === "carrier" && radioShipName(s.name) === "Enterprise");
  const b = freshBattle();
  const eid = enterprise(b).id;
  b.aircraft.push({ id: "d1", kind: "bomber", team: "jp", hp: 90, mode: "flight", tactic: "dive", target: eid, bombs: 1, x: 0, y: 1500, z: 7200, vx: 0, vy: 0, vz: 0 });
  b.aircraft.push({ id: "t1", kind: "torpedo", team: "jp", hp: 90, mode: "flight", tactic: "torpedo-run", target: eid, torpedo: 1, x: 200, y: 40, z: 7100, vx: 0, vy: 0, vz: 0 });
  b.updateRadio();
  const ids = speechIds(b);
  assert.ok(ids.includes("R07"), "an active dive run did not raise R07");
  assert.ok(ids.includes("R08"), "an active torpedo run did not raise R08");
}

// 5 — the alert breaks off: no attack for 15 s speaks R10 once.
{
  const b = freshBattle();
  const eid = b.ships.find((s) => s.team === "us" && s.kind === "carrier" && radioShipName(s.name) === "Enterprise").id;
  b.aircraft.push({ id: "d1", kind: "bomber", team: "jp", hp: 90, mode: "flight", tactic: "dive", target: eid, bombs: 1, x: 0, y: 1500, z: 7200, vx: 0, vy: 0, vz: 0 });
  b.updateRadio();
  b.events.length = 0;
  b.aircraft.length = 0;
  b.time += 16;
  b.updateRadio();
  assert.ok(speechIds(b).includes("R10"), "the attack broke off without an R10");
  b.events.length = 0;
  b.time += 5;
  b.updateRadio();
  assert.ok(!speechIds(b).includes("R10"), "R10 repeated while already reported");
}

// 6 — releasing a bomb speaks R17; engine damage and low fuel speak R13 and R14.
{
  const b = freshBattle();
  b.player.mode = "flight";
  b.player.bombs = 3;
  b.player.speed = 150;
  b.player.heading = 0;
  b.player.airframe = b.player.airframe || "sbd";
  b.dropBomb();
  assert.ok(speechIds(b).includes("R17"), "a bomb release did not speak R17");

  const c = freshBattle();
  c.player.damage.engine.integrity = 0.4;
  c.player.fuel = 12;
  c.updateRadio();
  const ids = speechIds(c);
  assert.ok(ids.includes("R13"), "engine damage did not speak R13");
  assert.ok(ids.includes("R14"), "low fuel did not speak R14");
}

// 7 — a friendly ship sinking and a friendly fire use the confirmed ship name, not the sim label.
{
  const b = freshBattle();
  const hornet = b.ships.find((s) => radioShipName(s.name) === "Hornet");
  b.damageShip(hornet, 10000, hornet, "bomb", "jp");
  const ev = b.events.find((e) => e.type === "speech" && e.request.id === "R15");
  assert.ok(ev, "a friendly sinking did not speak R15");
  assert.equal(ev.request.ship, "Hornet", `R15 carried the wrong ship name: ${ev.request.ship}`);
}

// 8 — the wingman warns real closure on the surface below, whatever the phase or gear, with a live
// wing nearby and a working cooldown. Gear down is not safety: a steep dive onto the deck warns.
{
  const wing = (over) => ({ id: "w1", wing: true, team: "us", hp: 100, mode: "flight", tactic: "escort", x: 0, y: 100, z: 300, vx: 0, vy: 0, vz: 0, ammo: 350, bombs: 0, torpedo: 0, ...over });
  const put = (b, over) => Object.assign(b.player, { mode: "flight", x: 0, z: 0, y: 60, vy: -20, pitch: -0.3, gear: false, ...over });

  const dive = freshBattle();
  put(dive, {});
  dive.aircraft.push(wing({ x: 300, y: 100, z: 0 }));
  dive.updateRadio();
  assert.ok(speechIds(dive).includes("R32"), "a steep low dive near a live wingman did not speak R32");
  dive.events.length = 0;
  dive.time += 5; dive.updateRadio();
  assert.ok(!speechIds(dive).includes("R32"), "R32 repeated inside its cooldown");
  dive.events.length = 0;
  dive.time += 16; dive.updateRadio();
  assert.ok(speechIds(dive).includes("R32"), "R32 did not repeat after its cooldown while still diving");

  // A nose-up stalled descent still warns: there is no pitch test, only closure.
  const stalled = freshBattle();
  put(stalled, { pitch: 0.4 });
  stalled.aircraft.push(wing({ x: 300, y: 100, z: 0 }));
  stalled.updateRadio();
  assert.ok(speechIds(stalled).includes("R32"), "a nose-up stalled descent did not warn");

  // A controlled landing sink rate (~-3 m/s) is not an imminent impact.
  const landing = freshBattle();
  put(landing, { vy: -3, pitch: -0.05 });
  landing.aircraft.push(wing({ x: 300, y: 100, z: 0 }));
  landing.updateRadio();
  assert.ok(!speechIds(landing).includes("R32"), "a controlled landing sink rate spoke R32");

  // Gear down does not exempt a steep dive onto the carrier's own deck.
  const deckDive = freshBattle();
  const cs = deckDive.recoveryCarrier;
  put(deckDive, { x: cs.x, z: cs.z, y: cs.deckHeight + 40, gear: true });
  deckDive.aircraft.push(wing({ x: cs.x + 300, y: cs.deckHeight + 60, z: cs.z }));
  deckDive.updateRadio();
  assert.ok(speechIds(deckDive).includes("R32"), "a gear-down dive onto the deck did not warn");

  const cruise = freshBattle();
  put(cruise, { y: 400, vy: 0, pitch: 0 });
  cruise.aircraft.push(wing({ x: 300, y: 400, z: 0 }));
  cruise.updateRadio();
  assert.ok(!speechIds(cruise).includes("R32"), "level cruise spoke R32");

  const lonely = freshBattle();
  put(lonely, {});
  lonely.updateRadio();
  assert.ok(!speechIds(lonely).includes("R32"), "R32 spoke with no wingman");

  const dead = freshBattle();
  put(dead, {});
  dead.aircraft.push(wing({ hp: 0, x: 300, y: 100, z: 0 }));
  dead.updateRadio();
  assert.ok(!speechIds(dead).includes("R32"), "R32 spoke with a dead wingman");

  const far = freshBattle();
  put(far, {});
  far.aircraft.push(wing({ x: 9000, y: 100, z: 0 }));
  far.updateRadio();
  assert.ok(!speechIds(far).includes("R32"), "R32 spoke with an out-of-range wingman");
}

// 9 — the wingman reports his own empty offensive stores, never the defensive rear gun, once per
// wingman; a second empty wingman is not blocked by the nearest already-reported one.
{
  const wing = (over) => ({ id: "w2", wing: true, team: "us", hp: 100, mode: "flight", tactic: "escort", x: 0, y: 120, z: 300, vx: 0, vy: 0, vz: 0, ammo: 350, bombs: 0, torpedo: 0, rearAmmo: 0, ...over });
  const b = freshBattle();
  b.player.x = 0; b.player.y = 100; b.player.z = 0;
  b.player.mode = "flight";
  const before = b.command;
  b.aircraft.push(wing({ id: "w1", x: 100, ammo: 0, rearAmmo: 600 }));
  b.updateRadio();
  assert.ok(speechIds(b).includes("R33"), "an out-of-ammo wingman did not speak R33");
  assert.equal(b.command, before, "R33 changed the wing command");

  b.events.length = 0;
  b.aircraft.push(wing({ id: "w3", x: 200, ammo: 0 }));
  b.updateRadio();
  const second = b.events.filter((e) => e.type === "speech" && e.request.id === "R33").map((e) => e.request.identity);
  assert.ok(second.includes("w3"), "a second empty wingman was blocked by the nearest reported one");

  b.events.length = 0;
  b.updateRadio();
  assert.ok(!speechIds(b).includes("R33"), "R33 repeated for a wingman who already reported");

  const armed = freshBattle();
  armed.player.x = 0; armed.player.y = 100; armed.player.z = 0;
  armed.player.mode = "flight";
  armed.aircraft.push(wing({ ammo: 0, bombs: 1 }));
  armed.updateRadio();
  assert.ok(!speechIds(armed).includes("R33"), "a wingman with bombs remaining was called empty");

  const rearOnly = freshBattle();
  rearOnly.player.x = 0; rearOnly.player.y = 100; rearOnly.player.z = 0;
  rearOnly.player.mode = "flight";
  rearOnly.aircraft.push(wing({ ammo: 0, bombs: 0, torpedo: 0, rearAmmo: 999 }));
  rearOnly.updateRadio();
  assert.ok(speechIds(rearOnly).includes("R33"), "rear ammo wrongly kept the wingman in the fight");

  const outOfRange = freshBattle();
  outOfRange.player.x = 0; outOfRange.player.y = 100; outOfRange.player.z = 0;
  outOfRange.player.mode = "flight";
  outOfRange.aircraft.push(wing({ x: 9000, ammo: 0 }));
  outOfRange.updateRadio();
  assert.ok(!speechIds(outOfRange).includes("R33"), "an out-of-range empty wingman spoke R33");
}

// 10 — the new lines are in the script and their slugs are packaged in the bank.
{
  assert.equal(SPEECH.R32.voice, "wingman", "R32 is not the wingman's");
  assert.equal(SPEECH.R32.priority, 1, "R32 priority changed");
  assert.equal(SPEECH.R33.priority, 2, "R33 priority changed");
  const slugs = speechSlugList();
  assert.ok(slugs.includes("r32") && slugs.includes("r33"), "r32/r33 missing from the speech slug list");
  assert.equal(resolveSpeech({ id: "R32" }).text, SPEECH.R32.text, "R32 caption must equal the spoken line");
}

console.log("check-radio: 10 checks passed");
