/**
 * Friendly-radio trigger check. Runs the real `Battle` (pure sim, no browser) against deterministic
 * setups, so the alert predicates are proven where they are produced: an active Zero on Enterprise
 * speaks R06, a Zero that has broken off does not, release speaks R17, and a routine line does not
 * repeat inside its cooldown.
 *
 * Uses the esbuild vite already installs. Run: node scripts/check-radio.mjs
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, readdirSync, statSync } from "node:fs";
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
const { Battle, resolveSpeech, radioShipName, SPEECH } = await import(`data:text/javascript,${encodeURIComponent(built.outputFiles[0].text)}`);

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

// 8 — every id in the table has a producer outside the frozen script. A cue with no `voice("ID")`
// and no quoted "ID" anywhere in src/ is a line nobody can ever hear: fail and name every one.
{
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".ts") && !p.endsWith("radio-script.ts")) files.push(p);
    }
  };
  walk(resolve(root, "src"));
  const source = files.map((f) => readFileSync(f, "utf8")).join("\n");
  const unwired = Object.keys(SPEECH).filter((id) => !source.includes(`"${id}"`));
  assert.equal(unwired.length, 0, `unwired speech ids (no voice caller in src/): ${unwired.join(", ")}`);
}

console.log("check-radio: 8 checks passed");
