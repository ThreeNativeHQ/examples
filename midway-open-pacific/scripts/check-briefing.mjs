/**
 * Briefing selection check (PRD AC-19).
 *
 * The briefing is the one place a player chooses a sortie kind, and its rules are invisible to a
 * screenshot: a category that silently vanishes looks exactly like one that was never offered.
 * This exercises `src/sim/briefing.ts` directly — no renderer — and asserts the five-category
 * ceiling, that an infeasible category is returned with a reason rather than omitted, the
 * surface-target exclusions, the one real fleet-support duty, that validateSelection agrees with
 * the map/cycle/contract paths, that a dead designation is an explicit retask/unavailable and never
 * a silent swap, and that frozen inputs never throw.
 *
 * Run: node scripts/check-briefing.mjs
 */
import assert from "node:assert/strict";
import { build } from "esbuild";

const { outputFiles } = await build({
  stdin: {
    contents:
      'export * from "./src/sim/briefing.ts"; export { targetEligible, eligibleTargets } from "./src/sim/sortie.ts";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const B = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);

const NOW = 1000;

const hull = (id, kind, over = {}) => ({
  id,
  name: id,
  kind,
  team: "jp",
  sunk: false,
  surfaced: true,
  deck: 1,
  ...over,
});
const akagi = hull("akagi", "carrier");
const tone = hull("tone", "cruiser");
const arashi = hull("arashi", "destroyer");
const i168 = hull("i168", "sub", { surfaced: true });
const deep = hull("i169", "sub", { surfaced: false });
const phelps = hull("phelps", "destroyer", { team: "us" });
const wreck = hull("mikuma", "cruiser", { sunk: true });
const fleet = [akagi, tone, arashi, i168, deep, phelps, wreck];

const contact = (id, kind, over = {}) => ({
  id,
  kind,
  observedAt: NOW,
  deliveredAt: NOW,
  lost: false,
  ...over,
});
const contacts = () => [
  contact("akagi", "carrier"),
  contact("tone", "cruiser"),
  contact("arashi", "destroyer"),
  contact("i168", "sub", { surfaced: true }),
  contact("i169", "sub", { surfaced: false }),
  contact("stale", "cruiser", { observedAt: NOW - 9999 }),
  contact("future", "cruiser", { deliveredAt: NOW + 1000 }),
];

// --- 1. offerBriefing never offers more than five categories, and flags the infeasible ones. ---
{
  const rich = {
    ships: fleet,
    aircraft: [{ team: "us", kind: "recon", dead: false }],
    contacts: contacts(),
    survivors: [{ id: "s1", rescued: false }],
  };
  const offer = B.offerBriefing(rich, NOW);
  assert.ok(offer.length <= 5, `at most five categories, got ${offer.length}`);
  assert.equal(offer.length, 5, "the briefing carries all five named categories");
  assert.deepEqual(
    offer.map((o) => o.kind),
    ["strike", "recon", "operation", "surface", "support"],
    "the five categories are exactly the PRD's list",
  );
  assert.equal(new Set(offer.map((o) => o.kind)).size, 5, "no category is repeated");
  for (const o of offer) {
    assert.equal(typeof o.label, "string");
    assert.equal(o.feasible, true, `${o.kind} should be feasible in a full battle`);
  }
}
{
  const empty = B.offerBriefing({}, NOW);
  assert.equal(empty.length, 5, "an empty world still shows every category, none omitted");
  const infeasible = empty.filter((o) => !o.feasible);
  assert.ok(infeasible.length >= 4, "the categories that cannot be flown are flagged");
  for (const o of infeasible) {
    assert.equal(o.feasible, false);
    assert.ok(o.reason && o.reason.length > 0, `${o.kind} must carry a reason, not be dropped`);
  }
  assert.ok(
    empty.some((o) => o.kind === "strike" && !o.feasible && o.reason.length > 0),
    "an offered-but-unavailable strike is explicit",
  );
}

// --- 2. surfaceStrikeTargets: cruisers/destroyers/surfaced subs only, delivered and fresh. ---
{
  const targets = B.surfaceStrikeTargets(contacts(), NOW);
  const ids = targets.map((t) => t.targetId);
  assert.ok(ids.includes("tone"), "a known cruiser is offered");
  assert.ok(ids.includes("arashi"), "a known destroyer is offered");
  assert.ok(ids.includes("i168"), "a surfaced submarine is offered");
  assert.ok(!ids.includes("akagi"), "a carrier is never a surface-strike target");
  assert.ok(!ids.includes("i169"), "a submerged submarine is never a surface-strike target");
  assert.ok(!ids.includes("stale"), "a stale contact is not offered");
  assert.ok(!ids.includes("future"), "an undelivered contact is not offered");
  for (const t of targets) {
    assert.equal(t.kind, "surface");
    assert.ok(["cruiser", "destroyer", "sub"].includes(t.targetKind), `${t.targetId}: target kind`);
  }
}

// --- 3. supportDuty: one real duty, or null, never invented. ---
{
  assert.equal(B.supportDuty({}, NOW), null, "an empty world offers no support duty");
  assert.equal(
    B.supportDuty({ ships: [phelps], aircraft: [], contacts: [], survivors: [] }, NOW),
    null,
    "a fleet with nothing to support has no duty",
  );
  const rich = {
    ships: fleet,
    aircraft: [{ team: "us", kind: "recon", dead: false }],
    contacts: contacts(),
    survivors: [{ id: "s1", rescued: false }],
  };
  const duty = B.supportDuty(rich, NOW);
  assert.ok(duty, "a busy battle offers exactly one duty");
  assert.equal(duty.kind, "support");
  assert.ok(
    ["scout-cover", "air-defence", "sub-report", "rescue-cover"].includes(duty.targetId),
    "the duty is one of the four the PRD names",
  );
  assert.ok(duty.detail.length > 0, "the duty comes with its orders");
  assert.equal(duty.feasible, true);
  assert.equal(
    B.supportDuty({ survivors: [{ id: "s1", rescued: false }] }, NOW).targetId,
    "rescue-cover",
    "with only survivors in the water the one real duty is rescue cover",
  );
}

// --- 4. validateSelection answers the same for the same {kind,id} on every consumer path. ---
{
  const world = { ships: fleet, contacts: contacts() };
  const option = (targetKind, targetId) => ({
    kind: "surface",
    targetKind,
    targetId,
    label: "",
    detail: "",
    feasible: true,
    reason: "",
  });
  const cases = [
    ["cruiser", "tone", true, tone],
    ["destroyer", "arashi", true, arashi],
    ["sub", "i168", true, i168],
    ["sub", "i169", false, deep],
    ["carrier", "akagi", false, akagi],
  ];
  const mapPath = B.surfaceStrikeTargets(world.contacts, NOW).map((t) => t.targetId);
  const cyclePath = B.eligibleTargets("surface", fleet);
  const offer = B.offerBriefing(world, NOW).find((o) => o.kind === "surface");
  assert.ok(offer && offer.feasible, "the briefing surfaces a hull when one exists");
  for (const [targetKind, targetId, expected, ship] of cases) {
    const validated = B.validateSelection(option(targetKind, targetId), world, NOW).ok;
    const offered = mapPath.includes(targetId);
    const cycled = cyclePath.some((t) => t.kind === targetKind && t.id === targetId);
    const contracted = B.targetEligible("surface", ship);
    assert.equal(validated, expected, `${targetId}: validateSelection`);
    assert.equal(offered, expected, `${targetId}: briefing/map enumeration`);
    assert.equal(cycled, expected, `${targetId}: TAB cycling`);
    assert.equal(contracted, expected, `${targetId}: the one target contract`);
    assert.equal(validated, offered, `${targetId}: validator and map path agree`);
    assert.equal(offered, cycled, `${targetId}: map path and cycling agree`);
    assert.equal(cycled, contracted, `${targetId}: cycling and target contract agree`);
  }
  assert.ok(mapPath.includes(offer.targetId), "the briefing's offered hull is one the map selects");
  assert.equal(B.validateSelection(offer, world, NOW).ok, true, "and the offered hull validates");
}

// --- 5. A dead designation is an explicit retask or unavailable, never a silent swap. ---
{
  const deadTone = { ...tone, sunk: true };
  const option = {
    kind: "surface",
    targetKind: "cruiser",
    targetId: "tone",
    label: "",
    detail: "",
    feasible: true,
    reason: "",
  };
  const withAnother = {
    ships: [deadTone, arashi, akagi, deep, phelps],
    contacts: [contact("tone", "cruiser"), contact("arashi", "destroyer")],
  };
  const retask = B.retaskOnUnavailable(option, withAnother, NOW);
  assert.equal(retask.result, "retask", "a dead hull with another legal hull left is a retask");
  assert.ok(retask.reason.length > 0, "the retask says why");
  assert.equal(option.targetId, "tone", "the dead designation is left in place, not swapped");
  const alone = {
    ships: [deadTone, akagi, deep, phelps],
    contacts: [contact("tone", "cruiser")],
  };
  const unavailable = B.retaskOnUnavailable(option, alone, NOW);
  assert.equal(unavailable.result, "unavailable", "no legal hull left is unavailable");
  assert.ok(unavailable.reason.length > 0, "the unavailable result says why");
  assert.notEqual(retask.result, "ok", "a dead target never reads as ok");
  assert.notEqual(unavailable.result, "ok", "an unavailable target never reads as ok");
  const live = { ships: fleet, contacts: contacts() };
  assert.equal(B.retaskOnUnavailable(option, live, NOW).result, "ok", "a live designation stays ok");
  const supportGone = B.retaskOnUnavailable(
    { kind: "support", targetKind: null, targetId: "scout-cover", label: "", detail: "", feasible: true, reason: "" },
    { survivors: [{ id: "s1", rescued: false }] },
    NOW,
  );
  assert.equal(supportGone.result, "retask", "a duty that vanished retasks to the one that is real");
}

// --- 6. Purity: freeze every input and assert nothing throws or is written. ---
{
  const deepFreeze = (v) => {
    if (v && typeof v === "object" && !Object.isFrozen(v)) {
      Object.freeze(v);
      for (const k of Object.keys(v)) deepFreeze(v[k]);
    }
    return v;
  };
  const world = deepFreeze({
    ships: fleet.map((s) => ({ ...s })),
    aircraft: [{ team: "us", kind: "recon", dead: false }],
    contacts: contacts(),
    survivors: [{ id: "s1", rescued: false }],
  });
  const before = JSON.stringify(world);
  const option = {
    kind: "surface",
    targetKind: "cruiser",
    targetId: "tone",
    label: "",
    detail: "",
    feasible: true,
    reason: "",
  };
  assert.doesNotThrow(() => {
    B.offerBriefing(world, NOW);
    B.surfaceStrikeTargets(world.contacts, NOW);
    B.supportDuty(world, NOW);
    B.validateSelection(option, world, NOW);
    B.retaskOnUnavailable(option, world, NOW);
  }, "frozen inputs never throw");
  assert.equal(JSON.stringify(world), before, "no input was written");
}

console.log("check-briefing: at most five categories, infeasible ones returned with a reason");
console.log("check-briefing: surface targets are cruisers/destroyers/surfaced subs from fresh delivered contacts");
console.log("check-briefing: one real support duty or null; validator, map, cycling and contract agree");
console.log("check-briefing: dead designations give explicit retask/unavailable; frozen inputs are pure");
