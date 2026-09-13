/**
 * Surface-strike and fleet-support assignment check (PRD AC-19).
 *
 * These rules are invisible to a screenshot and to a playtest: a sortie that completes on an
 * unobserved hit, on somebody else's kill, or on a weapon released for a previous target looks
 * exactly like one that was flown honestly. This exercises `src/sim/sortie.ts` directly — no
 * renderer, no Battle — and asserts the release stamp, the pending-confirmation rule, the explicit
 * unavailable/retask results, the participation arithmetic, duty feasibility, and that the one
 * target validator gives map selection, target cycling and debrief eligibility the same answer.
 *
 * Run: node scripts/check-sortie-kinds.mjs
 */
import assert from "node:assert/strict";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: ["src/sim/sortie.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const S = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);

const hull = (id, kind, over = {}) => ({ id, name: id, kind, team: "jp", sunk: false, surfaced: true, deck: 1, ...over });
const tone = hull("tone", "cruiser");
const arashi = hull("arashi", "destroyer");
const i168 = hull("i168", "sub");
const akagi = hull("akagi", "carrier");
const deep = hull("i169", "sub", { surfaced: false });
const phelps = hull("phelps", "destroyer", { team: "us" });
const wreck = hull("mikuma", "cruiser", { sunk: true });
const fleet = [tone, arashi, i168, akagi, deep, phelps, wreck];

// --- 1. A surface strike completes only on a confirmed hit on its own designated hull. ---
const surface = () => {
  const s = S.newSortie("surface", 0, 7);
  s.target = tone.id;
  return s;
};
{
  const s = surface();
  const mark = S.stamp(s, s.target, false);
  assert.equal(S.hitQualifies(s, mark, arashi, "bomb", false), false, "a hit on another ship must not qualify");
  assert.equal(S.hitQualifies(s, mark, akagi, "bomb", false), false, "a carrier is not this sortie's designated hull");
  assert.equal(S.hitQualifies(s, mark, tone, "gun", false), false, "strafing never satisfies a surface strike");
  assert.equal(S.hitQualifies(s, mark, tone, "bomb", true), false, "a near miss never satisfies a surface strike");
  assert.equal(S.hitQualifies(s, mark, tone, "bomb", false), true, "a direct bomb hit on the designated hull qualifies");
  S.recordObjectiveHit(s, tone, "bomb", false, { id: tone.id, time: 100 }, 101);
  assert.equal(s.objective, "achieved", "a hit the crew watched land completes the surface strike");
  assert.equal(S.assignmentComplete(s, [], 101), true, "assignmentComplete agrees with the objective state");
  // Carrier strike stays carrier-only.
  const cs = S.newSortie("strike", 0, 7);
  cs.target = tone.id;
  assert.equal(S.hitQualifies(cs, S.stamp(cs, tone.id, false), tone, "bomb", false), false, "carrier strike is carrier-only");
}

// --- 2. A hit the crew did not see completes nothing until a report dated at or after it arrives. ---
{
  const s = surface();
  S.recordObjectiveHit(s, tone, "torpedo", false, null, 400);
  assert.equal(s.objective, "pending", "an unobserved surface hit waits");
  assert.equal(s.pending.length, 1, "the unobserved hit is held in sortie.pending");
  assert.equal(S.assignmentComplete(s, [], 500), false, "an unconfirmed hit does not complete the assignment");
  S.confirmPending(s, () => ({ id: tone.id, time: 399.9 }));
  assert.equal(s.objective, "pending", "a report predating the impact confirms nothing");
  S.confirmPending(s, () => ({ id: tone.id, time: 400 }));
  assert.equal(s.objective, "achieved", "a report dated at the impact confirms it");
  assert.equal(s.pending.length, 0, "a confirmed hit leaves the pending list");
  const later = surface();
  S.recordObjectiveHit(later, tone, "bomb", false, null, 400);
  S.confirmPending(later, () => ({ id: tone.id, time: 612 }));
  assert.equal(later.objective, "achieved", "a later reconnaissance report also confirms it");
  const other = surface();
  S.recordObjectiveHit(other, tone, "bomb", false, null, 400);
  S.confirmPending(other, (id) => (id === arashi.id ? { id, time: 900 } : null));
  assert.equal(other.objective, "pending", "a report on a different ship confirms nothing");
}

// --- 3. A weapon stamped for sortie A earns nothing in sortie B, and nothing after a retask. ---
{
  const a = surface();
  const markA = S.stamp(a, tone.id, false);
  const b = S.newSortie("surface", 900, a.id + 1);
  b.target = tone.id;
  assert.equal(S.hitQualifies(b, markA, tone, "bomb", false), false, "a previous sortie's stamp cannot score in this one");
  a.target = arashi.id; // retasked in flight, after that weapon was already away
  assert.equal(S.hitQualifies(a, markA, arashi, "bomb", false), false, "a retask cannot grant credit to a weapon in the air");
  assert.equal(S.hitQualifies(a, markA, tone, "bomb", false), true, "nor can it revoke credit for the hull it was released at");
  assert.equal(S.hitQualifies(a, null, tone, "bomb", false), false, "an unstamped allied weapon scores nothing");
}

// --- 4. A dead or gone target gives an explicit result, never a substituted objective. ---
{
  const s = surface();
  assert.equal(S.designationStatus(s, fleet), "eligible", "a live designated cruiser is eligible");
  const sunkTone = { ...tone, sunk: true };
  const others = [sunkTone, arashi, akagi, deep, phelps, wreck];
  assert.equal(S.designationStatus(s, others), "retask", "a dead target with another legal hull left is a retask");
  assert.equal(s.target, tone.id, "designationStatus must not substitute a different target");
  const nothing = [sunkTone, akagi, deep, phelps, wreck];
  assert.equal(S.designationStatus(s, nothing), "unavailable", "a dead target with no legal hull left is unavailable");
  assert.equal(s.target, tone.id, "the unavailable result also leaves the record untouched");
  assert.deepEqual(S.eligibleTargets("surface", nothing), [], "a submerged boat and a friendly are not offered");
  assert.equal(S.designationStatus(S.newSortie("surface", 0, 1), fleet), "retask", "no designation at all reads as a retask");
}

// --- 5. Fleet support: the named event plus the player's own recorded part in it. ---
{
  const s = S.newSortie("support", 0, 3, "rescue-cover");
  assert.equal(s.duty, "rescue-cover", "the duty is carried on the record");
  assert.equal(S.assignmentComplete(s, [], 10), false, "nothing happened yet");
  const autonomous = [{ duty: "rescue-cover", time: 60, sortie: s.id, byPlayer: false }];
  assert.equal(S.participationEarned(s, autonomous), false, "waiting near an autonomous success earns nothing");
  assert.equal(S.assignmentComplete(s, autonomous, 90), false, "the named event alone does not complete support");
  const foreign = [...autonomous, { duty: "rescue-cover", time: 61, sortie: s.id + 1, byPlayer: true }];
  assert.equal(S.participationEarned(s, foreign), false, "another sortie's participation is not this sortie's");
  const wrongDuty = [...autonomous, { duty: "air-defence", time: 61, sortie: s.id, byPlayer: true }];
  assert.equal(S.participationEarned(s, wrongDuty), false, "taking part in a different duty is not this duty");
  const earned = [...autonomous, { duty: "rescue-cover", time: 62, sortie: s.id, byPlayer: true }];
  assert.equal(S.participationEarned(s, earned), true, "the player's own recorded action earns participation");
  assert.equal(S.assignmentComplete(s, earned, 90), true, "event plus participation completes the duty");
  assert.equal(S.assignmentComplete(s, earned, 10), false, "an event has not happened before its own time");
  const noDuty = S.newSortie("support", 0, 3, null);
  assert.equal(S.assignmentComplete(noDuty, earned, 90), false, "support with no duty completes nothing");
  assert.equal(S.newSortie("surface", 0, 3, "rescue-cover").duty, null, "only fleet support carries a duty");
}

// --- 6. The briefing is only ever offered duties that exist. ---
{
  assert.deepEqual(S.feasibleSupportDuties({}, 0), [], "an empty world offers no duty");
  const idle = { ships: [wreck, phelps, { ...akagi, sunk: true }], aircraft: [], contacts: [], survivors: [] };
  assert.deepEqual(S.feasibleSupportDuties(idle, 0), [], "a beaten fleet with nobody in the water offers no duty");
  assert.deepEqual(
    S.feasibleSupportDuties({ aircraft: [{ team: "us", kind: "recon" }] }, 0),
    ["scout-cover"],
    "a scout that is up can be covered",
  );
  assert.deepEqual(S.feasibleSupportDuties({ aircraft: [{ team: "us", kind: "recon", dead: true }] }, 0), [], "a dead scout cannot");
  assert.deepEqual(S.feasibleSupportDuties({ ships: [akagi] }, 0), ["air-defence"], "a launch-capable deck means a strike to meet");
  assert.deepEqual(S.feasibleSupportDuties({ ships: [{ ...akagi, deck: 0 }] }, 0), [], "a deck that cannot launch does not");
  assert.deepEqual(S.feasibleSupportDuties({ ships: [i168] }, 0), ["sub-report"], "a boat nobody has reported can be reported");
  assert.deepEqual(
    S.feasibleSupportDuties({ ships: [i168], contacts: [{ id: i168.id, time: 100 }] }, 100),
    [],
    "a boat the escort already has current information on needs no report",
  );
  assert.deepEqual(
    S.feasibleSupportDuties({ ships: [i168], contacts: [{ id: i168.id, time: 100 }] }, 100 + S.CONFIRM_WINDOW + 1),
    ["sub-report"],
    "once that information goes stale the duty is real again",
  );
  assert.deepEqual(S.feasibleSupportDuties({ survivors: [{ rescued: false }] }, 0), ["rescue-cover"], "survivors need cover");
  assert.deepEqual(S.feasibleSupportDuties({ survivors: [{ rescued: true }] }, 0), [], "recovered survivors do not");
  const busy = { ships: [akagi, i168], aircraft: [{ team: "us", kind: "recon" }], survivors: [{ rescued: false }] };
  assert.deepEqual(
    S.feasibleSupportDuties(busy, 0).sort(),
    ["air-defence", "rescue-cover", "scout-cover", "sub-report"],
    "a busy battle offers every duty that exists and no more",
  );
}

// --- 7. One validator: map selection, target cycling and debrief eligibility cannot disagree. ---
{
  for (const assignment of ["strike", "surface", "recon", "operation", "support"]) {
    const cycle = S.eligibleTargets(assignment, fleet);
    for (const ship of fleet) {
      // Map selection.
      const selectable = S.targetEligible(assignment, ship);
      // Target cycling: the pair contract, not the raw id.
      const cyclable = cycle.some((t) => t.kind === ship.kind && t.id === ship.id);
      // Debrief eligibility: a qualifying weapon released at this very hull.
      const s = S.newSortie(assignment, 0, 11);
      s.target = ship.id;
      const creditable = S.hitQualifies(s, S.stamp(s, ship.id, false), ship, "bomb", false);
      assert.equal(cyclable, selectable, `${assignment}/${ship.id}: cycling disagrees with selection`);
      assert.equal(creditable, selectable, `${assignment}/${ship.id}: debrief eligibility disagrees with selection`);
      assert.deepEqual(
        S.targetOf(ship),
        { kind: ship.kind, id: ship.id },
        `${assignment}/${ship.id}: the contract pair must come from the hull record`,
      );
    }
  }
  const designated = S.newSortie("surface", 0, 5);
  designated.target = i168.id;
  assert.deepEqual(S.designatedTarget(designated, fleet), { kind: "sub", id: i168.id }, "the designated pair resolves its kind");
  assert.equal(S.designatedTarget(S.newSortie("surface"), fleet), null, "nothing designated resolves to no pair");
}

console.log("check-sortie-kinds: 5 assignments, 7 hulls, 4 duties");
console.log("check-sortie-kinds: release stamp, pending confirmation, unavailable/retask, participation and one validator all hold");
