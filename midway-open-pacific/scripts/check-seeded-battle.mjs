/**
 * Seeded-battle reporting harness check. Bundles the pure module with esbuild and exercises it with
 * node:assert, no test framework. It proves the harness folds events, reports missing roles,
 * compares paired runs, digests traces and exposes the five seeds -- not that any particular battle
 * role occurs. Run: node scripts/check-seeded-battle.mjs
 */
import assert from "node:assert/strict";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: ["src/sim/seeded-battle.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const sb = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);

// One representative event per role, in the module's own declaration order.
const EVENTS = [
  ["scout-report", { type: "report", delivered: false }],
  ["contact-delivered", { type: "report", delivered: true }],
  ["strike-launched", { type: "launch", role: "torpedo" }],
  ["escort-engaged", { type: "tactic", tactic: "escort" }],
  ["submarine-attack", { type: "submarine", mode: "periscope", fired: true }],
  ["depth-charge", { type: "hunt", phase: "reattack", salvoes: 1 }],
  ["rescue-started", { type: "rescue", phase: "recovering" }],
  ["alongside-assist", { type: "assist", phase: "alongside" }],
  ["facility-hit", { type: "facility", kind: "stores", damage: 0.4 }],
  ["scout-cover", { type: "support", duty: "scout-cover" }],
  ["air-defence", { type: "support", duty: "air-defence" }],
  ["sub-report", { type: "support", duty: "sub-report" }],
  ["rescue-cover", { type: "support", duty: "rescue-cover" }],
];

// observeRole counts each role once per event, returns a new record, and never writes its input.
let tally = sb.newTally();
for (const [role, event] of EVENTS) {
  const frozenTally0 = Object.freeze({ ...tally });
  const before = { ...tally };
  const next = sb.observeRole(frozenTally0, Object.freeze(event));
  assert.notEqual(next, frozenTally0, "observeRole returns a new record");
  assert.deepEqual(frozenTally0, before, `folding ${role} did not mutate the input tally`);
  assert.equal(next[role], before[role] + 1, `${role} counted exactly once`);
  for (const other of sb.ROLES) {
    if (other !== role) assert.equal(next[other], before[other], `${other} was not counted by a ${role} event`);
  }
  tally = next;
}
assert.deepEqual(sb.rolesOccurred(tally), sb.ROLES, "one event per role reports every role, in order");

// An event that evidences no role still returns a fresh, unchanged record rather than throwing.
const nonRole = sb.observeRole(tally, { type: "launch", role: "fighter" });
assert.deepEqual(nonRole, tally, "a fighter launch is not a strike and changes nothing");
assert.notEqual(nonRole, tally, "but it is still a new record");
const unknown = sb.observeRole(tally, { type: "not-a-battle-event" });
assert.deepEqual(unknown, tally, "an unknown event is ignored, not fatal");

// rolesMissing reports exactly what was expected and not seen, once per expected role.
const partial = { ...sb.newTally(), "contact-delivered": 2, "facility-hit": 1 };
assert.deepEqual(
  sb.rolesMissing(partial, ["scout-report", "contact-delivered", "facility-hit"]),
  ["scout-report"],
  "only the expected-and-absent role is missing",
);
assert.deepEqual(
  sb.rolesMissing(partial, ["scout-report", "scout-report", "contact-delivered"]),
  ["scout-report"],
  "a repeated expectation is reported once",
);
assert.deepEqual(sb.rolesMissing(partial, ["contact-delivered"]), [], "a seen role is not missing");

// pairedComparison: a difference is changed; an identical role is unchanged.
const without = { ...sb.newTally() };
const withIntervention = sb.observeRole(sb.newTally(), { type: "report", delivered: true });
const changedCase = sb.pairedComparison(withIntervention, without);
assert.ok(changedCase.changed.includes("contact-delivered"), "a differing role is reported changed");
assert.deepEqual(changedCase.changed, ["contact-delivered"], "only the differing role is changed");
assert.ok(changedCase.unchanged.includes("scout-report"), "an identical role is reported unchanged");
assert.equal(changedCase.unchanged.length, sb.ROLES.length - 1, "every other role is unchanged");
const unchangedCase = sb.pairedComparison(sb.newTally(), sb.newTally());
assert.deepEqual(unchangedCase.changed, [], "identical tallies changed nothing");
assert.deepEqual(unchangedCase.unchanged, sb.ROLES, "and leave every role unchanged");

// traceDigest is stable for identical sequences and changes for a single altered value.
const runA = [{ t: 0, x: 1, y: 2 }, { t: 1, x: 4, y: 5 }];
const runB = [{ t: 0, x: 1, y: 2 }, { t: 1, x: 4, y: 5 }];
assert.equal(sb.traceDigest(runA), sb.traceDigest(runB), "identical traces digest equally");
const runC = [{ t: 0, x: 1, y: 2 }, { t: 1, x: 4, y: 5.0000001 }];
assert.notEqual(sb.traceDigest(runA), sb.traceDigest(runC), "one changed value changes the digest");
const reorderedKeys = [{ y: 2, x: 1, t: 0 }, { y: 5, x: 4, t: 1 }];
assert.equal(sb.traceDigest(runA), sb.traceDigest(reorderedKeys), "key order never changes the digest");
assert.match(sb.traceDigest(runA), /^[0-9a-f]{8}$/, "the digest is a fixed-width hex string");

// SEEDS is exactly the five named seeds, in order.
assert.deepEqual(sb.SEEDS, [19420604, 19420605, 19420606, 19420607, 19420608], "the five named seeds");
assert.ok(Object.isFrozen(sb.SEEDS) || sb.SEEDS.length === 5, "the seed list is the expected length");

// Purity: every input frozen, no function throws, no input is written.
const frozenTally = Object.freeze({ ...sb.newTally(), "facility-hit": 1, "depth-charge": 3 });
const frozenEvents = Object.freeze(EVENTS.map(([, event]) => Object.freeze(event)));
const frozenTrace = Object.freeze([Object.freeze({ t: 0, x: 1 }), Object.freeze({ t: 1, x: 2 })]);
const expectedRoles = Object.freeze([...sb.ROLES]);
assert.doesNotThrow(() => {
  for (const event of frozenEvents) sb.observeRole(frozenTally, event);
  sb.rolesOccurred(frozenTally);
  sb.rolesMissing(frozenTally, expectedRoles);
  sb.pairedComparison(frozenTally, frozenTally);
  sb.traceDigest(frozenTrace);
}, "frozen inputs never throw");
assert.equal(frozenTally["facility-hit"], 1, "the frozen tally is untouched");
assert.equal(frozenTally["depth-charge"], 3, "the frozen tally is untouched");
assert.equal(sb.traceDigest(frozenTrace), sb.traceDigest([{ t: 0, x: 1 }, { t: 1, x: 2 }]), "reading a frozen trace is stable");

console.log(
  JSON.stringify({
    pass: true,
    roles: sb.ROLES.length,
    seeds: sb.SEEDS,
    digest: sb.traceDigest(runA),
    changed: changedCase.changed,
  }),
);
