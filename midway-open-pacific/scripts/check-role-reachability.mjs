/**
 * Role-reachability check (PRD AC-21, second half).
 *
 * `tools/capture-battle-roles.mjs` is the first half: it runs the five named natural seeds and
 * reports which roles occur. The six remaining roles it never saw are proven reachable — or shown
 * not to be — here, one bounded scenario per role, driving a real `Battle` through `step()` and its
 * ordinary entry points only. Nothing in this file assigns a tactic, a mode, a target, a mission, a
 * scout state or a survivor's rescued flag: every role is read back through the same
 * `observeRole` in `src/sim/seeded-battle.ts` the capture tool folds with, so the check cannot
 * invent a role the simulation did not produce. A scenario that needs a field written to fire is
 * reported as a failure naming that field, which is the honest outcome.
 *
 * Uses the esbuild vite already installs. Run: node scripts/check-role-reachability.mjs
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
      export {
        newTally, observeRole, rolesOccurred, ROLES,
      } from "./src/sim/seeded-battle.ts";
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
const { Battle, newTally, observeRole, rolesOccurred, ROLES } = await import(
  `data:text/javascript,${encodeURIComponent(built.outputFiles[0].text)}`
);

const STEP = 1 / 30;
const failures = [];

/**
 * Run one labelled claim and print PASS/FAIL. A claim returns a short string naming the bound it
 * needed; a failed assert is reported and the rest still run, exactly as the other wiring checks do.
 */
function claim(name, fn) {
  try {
    const bound = fn();
    console.log(`PASS  ${name}  [${bound}]`);
  } catch (err) {
    failures.push({ name, message: err.message });
    console.log(`FAIL  ${name}\n      ${err.message}`);
  }
}

/**
 * A battle under way, watched through the one `observeRole`. The wrapper folds only events the
 * simulation itself emitted through `Battle.event`; it never synthesises one. `setup` may write
 * feasible initial conditions through the public record (a ship's position, its stores) and drive
 * the world through the ordinary sensor entries (`recordContact`, `report`, `fileReport`).
 */
function scenario(seed, setup) {
  const b = new Battle(seed);
  const state = { tally: newTally(), first: {}, step: 0 };
  const fold = (event) => {
    const before = state.tally;
    state.tally = observeRole(before, event);
    for (const role of ROLES)
      if (state.tally[role] > before[role] && state.first[role] === undefined) state.first[role] = state.step;
  };
  const realEvent = b.event.bind(b);
  b.event = (type, data = {}) => {
    if (type === "facility") fold({ type: "facility", kind: data.kind, damage: data.damage });
    else if (type === "hunt") fold({ type: "hunt", phase: data.phase, salvoes: data.salvoes });
    else if (type === "support") fold({ type: "support", duty: data.duty });
    return realEvent(type, data);
  };
  b.start();
  // Spectator is the game's own mode and writes no task or AI field; it simply leaves the player out
  // of the physics so the fleet's own behaviour is what is under test.
  b.player.mode = "spectator";
  setup?.(b);
  return { b, state };
}

/** Step a scenario until `role` occurs or `seconds` of simulated time have elapsed. */
function drive(sc, role, seconds) {
  const limit = Math.round(seconds / STEP);
  for (; sc.state.step < limit; sc.state.step += 1) {
    sc.b.step(STEP, {});
    if (sc.state.tally[role] > 0) break;
  }
  return {
    occurred: sc.state.tally[role] > 0,
    at: (sc.state.first[role] ?? 0) * STEP,
    time: sc.b.time,
    status: sc.b.status,
    tally: sc.state.tally,
    occurredRoles: rolesOccurred(sc.state.tally),
  };
}

/** The one line a role's PASS should print: how long the scenario took, and its stated bound. */
const bound = (r, seconds) => `role at ${r.at.toFixed(1)}s, bound ${seconds}s`;

// ---------------------------------------------------------------------------------------------
// facility-hit — a Japanese follow-up island strike bombs a Midway facility
// ---------------------------------------------------------------------------------------------

claim("facility-hit — a Japanese report of Midway draws the follow-up strike", () => {
  const SECONDS = 480;
  // Feasible initial condition only: a Japanese destroyer on picket within her lookouts' reach of
  // the atoll, and the Japanese carriers held off the U.S. task force so the Nagumo choice is theirs
  // to make. No mission, tactic or target is written.
  const sc = scenario(19420604, (b) => {
    const picket = b.ships.find((s) => s.team === "jp" && s.kind === "destroyer");
    picket.x = b.island.x - 3600;
    picket.z = b.island.z + 200;
    for (const cv of b.ships.filter((s) => s.team === "jp" && s.kind === "carrier")) {
      cv.x += 26000;
    }
    // The lookout sweep that files the facility report is the battle's own; the staff's follow-up
    // decision then rides on the delivered report, exactly as AC-12's facility check describes.
    b.observeFacilities();
  });
  const r = drive(sc, "facility-hit", SECONDS);
  assert.ok(
    r.occurred,
    `no facility was bombed within ${SECONDS} s (battle ${r.status}); a Japanese observer held ` +
      `Midway at ${sc.b.time.toFixed(0)} s and islandStrike=${sc.b.islandStrike}, followUpPending=${sc.b.followUpPending}`,
  );
  return bound(r, SECONDS);
});

// ---------------------------------------------------------------------------------------------
// depth-charge — an escort's anti-submarine hunt drops a live salvo
// ---------------------------------------------------------------------------------------------

claim("depth-charge — an escort hunts a sighted boat and drops a salvo", () => {
  const SECONDS = 150;
  const sc = scenario(19420604, (b) => {
    const sub = b.ships.find((s) => s.name === "I-168");
    const escort = b.ships.find((s) => s.name === "USS Phelps");
    // Feasible initial condition: the escort and the boat are in the same water. The bridge lookout
    // (the player's own sensor record) sights the surfaced boat and the contact goes on the net.
    escort.x = sub.x + 900;
    escort.z = sub.z;
    b.recordContact(sub);
    b.report();
  });
  const r = drive(sc, "depth-charge", SECONDS);
  assert.ok(
    r.occurred,
    `no ASW salvo left the racks within ${SECONDS} s. Battle never calls asw.stepHunt: no escort ` +
      `owns an AswState, so an escort cannot progress searching/investigating/attacking and no ` +
      `"hunt" event with salvoes>0 is ever emitted. The field that would have to be written is an ` +
      `escort hunt state (\`s.hunt\`, an AswState) — it does not exist; the run reached ` +
      `${r.occurredRoles.join(", ") || "none of the facility/hunt/support roles"} instead`,
  );
  return bound(r, SECONDS);
});

// ---------------------------------------------------------------------------------------------
// sub-report — the sighted boat's contact is passed to the escort
// ---------------------------------------------------------------------------------------------

claim("sub-report — a sighted enemy boat is reported to the fleet", () => {
  const SECONDS = 90;
  let filed = 0;
  const sc = scenario(19420604, (b) => {
    const sub = b.ships.find((s) => s.name === "I-168");
    const escort = b.ships.find((s) => s.name === "USS Phelps");
    escort.x = sub.x + 900;
    escort.z = sub.z;
    // A normal sensor/lookout sighting and transmission, exactly the path a real sub report takes.
    b.recordContact(sub);
    filed = b.report();
  });
  const r = drive(sc, "sub-report", SECONDS);
  const delivered = [...sc.b.teamIntel.us.values()].filter((c) => c.kind === "sub" || c.classification === "submarine").length;
  assert.ok(
    r.occurred,
    `the boat was sighted (report() filed ${filed}, ${delivered} U.S. sub track(s) held) yet no support event ` +
      `was produced within ${SECONDS} s. Battle never appends a sortie.ISupportEvent: there is no ` +
      `supportEvents record or "support" event producer at all, so the sub-report duty cannot occur ` +
      `without writing the event directly`,
  );
  return bound(r, SECONDS);
});

// ---------------------------------------------------------------------------------------------
// scout-cover — the reconnaissance contact is transmitted under escort
// ---------------------------------------------------------------------------------------------

claim("scout-cover — a reconnaissance contact is delivered while a fighter is up", () => {
  const SECONDS = 120;
  const sc = scenario(19420604, () => {
    // Nothing written: `start()` and the battle's own clock put a Catalina and the carriers' CAP
    // aloft. The scenario only waits for the scout's report to reach the fleet.
  });
  const r = drive(sc, "scout-cover", SECONDS);
  const recon = sc.b.aircraft.some((a) => a.team === "us" && a.kind === "recon" && a.hp > 0);
  const delivered = [...sc.b.teamIntel.us.values()].length;
  assert.ok(
    r.occurred,
    `a U.S. reconnaissance aircraft was airborne=${recon} and the fleet held ${delivered} delivered ` +
      `report(s), yet no scout-cover support event occurred within ${SECONDS} s. The duty's named ` +
      `outcome is a scout contact transmitted, but Battle never appends an ISupportEvent, so the ` +
      `role cannot occur without writing the event itself`,
  );
  return bound(r, SECONDS);
});

// ---------------------------------------------------------------------------------------------
// air-defence — an incoming Japanese strike is broken up
// ---------------------------------------------------------------------------------------------

claim("air-defence — an incoming Japanese strike is met before the task force", () => {
  const SECONDS = 150;
  const sc = scenario(19420604, (b) => {
    // Feasible initial condition: the Japanese carriers are brought within strike range of the U.S.
    // force so their aircraft actually come, and the U.S. CAP is left to meet them. No tactic, mode
    // or target is written on any aircraft.
    for (const cv of b.ships.filter((s) => s.team === "jp" && s.kind === "carrier")) {
      cv.x += 14000;
      cv.z += 2000;
      cv.baseSpeed = 8;
    }
  });
  const r = drive(sc, "air-defence", SECONDS);
  const jpAir = sc.b.aircraft.filter((a) => a.team === "jp" && a.hp > 0).length;
  assert.ok(
    r.occurred,
    `Japanese aircraft were airborne (${jpAir} live at the end) and the battle ran ${SECONDS} s, ` +
      `yet no air-defence support event occurred. Battle never appends an ISupportEvent, and no ` +
      `existing event type maps to air-defence in observeRole; the role would have to be forced by ` +
      `writing the event (or an aircraft's tactic) directly`,
  );
  return bound(r, SECONDS);
});

// ---------------------------------------------------------------------------------------------
// rescue-cover — survivors are brought aboard under cover
// ---------------------------------------------------------------------------------------------

claim("rescue-cover — a rescue completes over the water", () => {
  const SECONDS = 300;
  const sc = scenario(19420604, (b) => {
    // Feasible initial condition: a Japanese destroyer is sunk beside a U.S. escort, which is the
    // normal way a rescue opportunity exists. Nothing writes a survivor's rescued flag or a ship's
    // rescue task; `updateRescue` decides whether to work the water.
    const victim = b.ships.find((s) => s.kind === "destroyer" && s.team === "jp");
    const escort = b.ships.find((s) => s.name === "USS Hammann");
    victim.x = escort.x + 60;
    victim.z = escort.z;
    b.damageShip(victim, 9999, { x: victim.x, y: 0, z: victim.z }, "bomb", "us");
  });
  const r = drive(sc, "rescue-cover", SECONDS);
  const rescued = sc.b.ships.reduce((n, s) => n + (s.recovered ?? 0), 0);
  assert.ok(
    r.occurred,
    `survivors were recovered over water (${rescued.toFixed(1)} aboard in ${SECONDS} s) yet no ` +
      `rescue-cover support event occurred. The duty's named outcome — survivors aboard — is real in ` +
      `the simulation, but Battle never appends an ISupportEvent, so the role cannot occur without ` +
      `writing the event (or a survivor's rescued flag) directly`,
  );
  return bound(r, SECONDS);
});

// ---------------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------------

console.log("");
if (failures.length) {
  console.log(`check-role-reachability: ${failures.length} of 6 claim(s) FAILED`);
  for (const f of failures) console.log(`  - ${f.name}`);
  process.exitCode = 1;
} else {
  console.log("check-role-reachability: all six remaining roles are reachable through normal Battle entry");
}
