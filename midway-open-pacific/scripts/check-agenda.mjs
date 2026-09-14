/**
 * Check for the pure `src/sim/agenda.ts` helpers. No browser, no test framework: esbuild bundles the
 * TS and node:assert/strict asserts the priority order, commitment window, strike preconditions,
 * CAP arithmetic, material-change rule, name independence and purity. Run: node scripts/check-agenda.mjs
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const built = await build({
  stdin: {
    contents:
      'export * from "./src/sim/agenda.ts"; export { STALE_SECONDS } from "./src/sim/intel.ts";',
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
  chooseAgenda,
  strikeWorthwhile,
  capCommitment,
  reevaluate,
  COMMIT_SECONDS,
  STALE_SECONDS,
} = await import(`data:text/javascript,${encodeURIComponent(built.outputFiles[0].text)}`);

const freeze = (o) => Object.freeze(o);
const resources = (over = {}) =>
  freeze({ readyAircraft: 12, readyFighters: 8, stores: 1, fuel: 1, ...over });
const situation = (over = {}) =>
  freeze({
    survival: false,
    recovery: false,
    localDefence: false,
    committedFeasible: true,
    opportunity: null,
    patrol: false,
    ...over,
  });

// 1 — survival outranks everything: a committed strike withdraws under immediate threat.
{
  const strike = freeze({ groupId: "g1", intent: "strike", targetId: "cv-1", committedAt: 100, reason: "fresh carrier contact" });
  const group = freeze({ id: "g1", ...resources(), agenda: strike });
  const withdrawn = chooseAgenda(group, situation({ survival: true }), 110);
  assert.equal(withdrawn.intent, "withdraw", `survival must withdraw even mid-strike, got ${withdrawn.intent}`);
  assert.equal(withdrawn.targetId, null, "a withdrawal carries no target");
  assert.equal(withdrawn.reason, "withdrawal ordered", `withdrawal reason should be readable, got ${withdrawn.reason}`);
}

// 2 — the commitment window holds against a merely-better opportunity; survival replaces it.
{
  const strike = freeze({ groupId: "g1", intent: "strike", targetId: "cv-1", committedAt: 100, reason: "fresh carrier contact" });
  const group = freeze({ id: "g1", ...resources(), agenda: strike });
  const opportunity = freeze({ intent: "search", targetId: "cv-9", reason: "no fresh contact" });
  const kept = chooseAgenda(group, situation({ committedFeasible: false, opportunity }), 100 + COMMIT_SECONDS - 1);
  assert.equal(kept.intent, "strike", `a committed agenda must survive the window, got ${kept.intent}`);
  assert.equal(kept.targetId, "cv-1", "the committed target must be kept");
  assert.equal(kept.committedAt, 100, "keeping an agenda must not reset its commitment clock");
  const replaced = chooseAgenda(group, situation({ committedFeasible: false, opportunity, survival: true }), 105);
  assert.equal(replaced.intent, "withdraw", `survival must replace a fresh commitment, got ${replaced.intent}`);
  const expired = chooseAgenda(group, situation({ committedFeasible: false, opportunity }), 100 + COMMIT_SECONDS);
  assert.equal(expired.intent, "search", `after the window the opportunity must win, got ${expired.intent}`);
}

// 3 — recovery and local defence outrank a committed task; each has its own reason.
{
  const strike = freeze({ groupId: "g1", intent: "strike", targetId: "cv-1", committedAt: 100, reason: "fresh carrier contact" });
  const group = freeze({ id: "g1", ...resources(), agenda: strike });
  const recovering = chooseAgenda(group, situation({ recovery: true }), 105);
  assert.equal(recovering.intent, "recover", `recovery must outrank the committed task, got ${recovering.intent}`);
  assert.equal(recovering.reason, "low fuel", `recovery reason should be low fuel, got ${recovering.reason}`);
  const defending = chooseAgenda(group, situation({ localDefence: true }), 105);
  assert.equal(defending.intent, "cap", `local defence must outrank the committed task, got ${defending.intent}`);
  assert.equal(defending.reason, "escort requested", `cap reason should be escort requested, got ${defending.reason}`);
}

// 4 — strikeWorthwhile is false for each separate cause, with its reason.
{
  const group = freeze({ id: "g1" });
  const now = 1000;
  const good = freeze({ targetId: "cv-1", observedAt: now - 30, deliveredAt: now - 20, lost: false });

  const none = strikeWorthwhile(group, null, resources(), now);
  assert.equal(none.worthwhile, false, "no contact must not be worthwhile");
  assert.equal(none.reason, "no delivered contact", `null contact reason, got ${none.reason}`);

  const undelivered = freeze({ targetId: "cv-1", observedAt: now - 30, deliveredAt: now + 5, lost: false });
  const pending = strikeWorthwhile(group, undelivered, resources(), now);
  assert.equal(pending.worthwhile, false, "an undelivered report must not be worthwhile");
  assert.equal(pending.reason, "no delivered contact", `undelivered contact reason, got ${pending.reason}`);

  const stale = freeze({ targetId: "cv-1", observedAt: now - STALE_SECONDS - 1, deliveredAt: now - STALE_SECONDS, lost: true });
  const old = strikeWorthwhile(group, stale, resources(), now);
  assert.equal(old.worthwhile, false, "a stale contact must not be worthwhile");
  assert.equal(old.reason, "stale contact", `stale contact reason, got ${old.reason}`);

  const noAircraft = strikeWorthwhile(group, good, resources({ readyAircraft: 0 }), now);
  assert.equal(noAircraft.worthwhile, false, "no ready aircraft must not be worthwhile");
  assert.equal(noAircraft.reason, "no ready aircraft", `no aircraft reason, got ${noAircraft.reason}`);

  const noStores = strikeWorthwhile(group, good, resources({ stores: 0 }), now);
  assert.equal(noStores.worthwhile, false, "no stores must not be worthwhile");
  assert.equal(noStores.reason, "no stores", `no stores reason, got ${noStores.reason}`);

  const yes = strikeWorthwhile(group, good, resources(), now);
  assert.equal(yes.worthwhile, true, "a delivered, unstale contact with aircraft and stores is worthwhile");
}

// 5 — NO NAME DEPENDENCE: swapping the ships' and group's names changes nothing.
{
  const now = 500;
  const opportunity = freeze({ intent: "strike", targetId: "cv-1", reason: "fresh carrier contact" });
  const sit = situation({ committedFeasible: false, opportunity });
  const build = (name, shipNames) =>
    freeze({ id: "g1", name, ships: shipNames.map((n) => freeze({ name: n })), ...resources(), agenda: null });
  const a = build("Akagi", ["Akagi", "Kaga"]);
  const b = build("Soryu", ["Soryu", "Hiryu"]);
  assert.deepEqual(chooseAgenda(a, sit, now), chooseAgenda(b, sit, now), "names must not change the agenda");
  const good = freeze({ targetId: "cv-1", observedAt: now - 10, deliveredAt: now - 5, lost: false });
  assert.deepEqual(
    strikeWorthwhile(a, good, resources(), now),
    strikeWorthwhile(b, good, resources(), now),
    "names must not change strike worth",
  );
}

// 6 — capCommitment falls as escort demand rises, and never exceeds remaining fighters.
{
  const group = freeze({ readyFighters: 10 });
  const none = capCommitment(group, 10, 0);
  const some = capCommitment(group, 10, 2);
  const lots = capCommitment(group, 10, 4);
  assert.ok(none > some && some > lots, `more escort must mean fewer at home, got ${none}, ${some}, ${lots}`);
  assert.equal(capCommitment(freeze({ readyFighters: 3 }), 10, 5), 0, "escorting more than available leaves no CAP");
  assert.equal(capCommitment(group, 0, 0), 0, "no sensed threat demands no CAP");
}

// 7 — reevaluate is true on a material change, false on noise inside the window.
{
  const agenda = freeze({ groupId: "g1", intent: "strike", targetId: "cv-1", committedAt: 100, reason: "fresh carrier contact" });
  const material = freeze({ damage: 0.5, stores: 0, information: 0, orders: false });
  assert.equal(reevaluate(agenda, material, 110), true, "material damage must force a re-decision");
  const orders = freeze({ damage: 0, stores: 0, information: 0, orders: true });
  assert.equal(reevaluate(agenda, orders, 110), true, "new orders must force a re-decision");
  const noise = freeze({ damage: 0.1, stores: 0.05, information: 0.1, orders: false });
  assert.equal(reevaluate(agenda, noise, 110), false, "noise inside the window must not force a re-decision");
  assert.equal(
    reevaluate(agenda, noise, 100 + COMMIT_SECONDS),
    true,
    "a lapsed window is itself reason to re-decide",
  );
}

// 8 — purity: every input frozen, nothing throws, repeated calls agree.
{
  const strike = freeze({ groupId: "g1", intent: "strike", targetId: "cv-1", committedAt: 100, reason: "fresh carrier contact" });
  const group = freeze({ id: "g1", ...resources(), agenda: strike });
  const sit = situation({ committedFeasible: false, opportunity: freeze({ intent: "search", targetId: null, reason: "no fresh contact" }) });
  assert.doesNotThrow(() => chooseAgenda(group, sit, 130), "chooseAgenda must not mutate its inputs");
  assert.deepEqual(chooseAgenda(group, sit, 130), chooseAgenda(group, sit, 130), "chooseAgenda must be repeatable");

  const contact = freeze({ targetId: "cv-1", observedAt: 90, deliveredAt: 95, lost: false });
  assert.doesNotThrow(() => strikeWorthwhile(group, contact, resources(), 130), "strikeWorthwhile must not mutate its inputs");
  assert.deepEqual(
    strikeWorthwhile(group, contact, resources(), 130),
    strikeWorthwhile(group, contact, resources(), 130),
    "strikeWorthwhile must be repeatable",
  );

  const change = freeze({ damage: 0.9, stores: 0, information: 0, orders: false });
  assert.doesNotThrow(() => reevaluate(strike, change, 130), "reevaluate must not mutate its inputs");
  assert.equal(reevaluate(strike, change, 130), reevaluate(strike, change, 130), "reevaluate must be repeatable");
}

console.log("check-agenda: all assertions passed");
