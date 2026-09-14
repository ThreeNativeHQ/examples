/**
 * Check for the pure `src/sim/airgroup.ts` helpers. No browser, no test framework: esbuild bundles
 * the TS and node:assert/strict asserts composition floors, the bounded form-up deadline, escort
 * separation reasons, abort reasons, the Kate loadout and purity. Run: node scripts/check-airgroup.mjs
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const built = await build({
  stdin: {
    contents:
      'export * from "./src/sim/airgroup.ts"; export { STALE_SECONDS } from "./src/sim/intel.ts";',
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
  composePackage,
  assemble,
  escortDecision,
  abortCriteria,
  kateLoadout,
  STALE_SECONDS,
} = await import(`data:text/javascript,${encodeURIComponent(built.outputFiles[0].text)}`);

const freeze = (o) => Object.freeze(o);
const doctrine = freeze({ minStrikers: 4, escortPerStriker: 0.5, minEscorts: 2, maxEscorts: 6 });
const contact = freeze({ id: "cv-1" });
const pkg = (over = {}) =>
  freeze({
    id: "pkg-g1-cv-1",
    groupId: "g1",
    targetContactId: "cv-1",
    strikers: 9,
    escorts: 4,
    launchedAt: 100,
    phase: "forming",
    ...over,
  });

// 1 — too few strikers is not worth the aircraft; enough produces a sane package.
{
  const weak = composePackage(freeze({ groupId: "g1", strikers: 3, escorts: 4, at: 100 }), contact, doctrine);
  assert.equal(weak, null, "fewer strikers than the doctrine floor must stand the package down");

  const unescorted = composePackage(freeze({ groupId: "g1", strikers: 9, escorts: 1, at: 100 }), contact, doctrine);
  assert.equal(unescorted, null, "fewer escorts than the floor must stand the package down");

  const none = composePackage(freeze({ groupId: "g1", strikers: 9, escorts: 4, at: 100 }), null, doctrine);
  assert.equal(none, null, "no delivered contact means no package");

  const good = composePackage(freeze({ groupId: "g1", strikers: 9, escorts: 4, at: 100 }), contact, doctrine);
  assert.ok(good, "a ready group against a delivered contact must produce a package");
  assert.equal(good.strikers, 9, "the package sends every ready striker");
  assert.ok(good.escorts >= doctrine.minEscorts && good.escorts <= doctrine.maxEscorts, `escorts within floor and cap, got ${good.escorts}`);
  assert.equal(good.targetContactId, "cv-1", "the package names the contact it was composed from");
  assert.equal(good.phase, "forming", "a fresh package starts forming");
  assert.equal(good.launchedAt, 100, "the form-up clock starts when readiness was read");
}

// 2 — assemble launches when formed, waits inside the window, then goes anyway or stands down.
{
  const limits = freeze({ minStrikers: 4, minEscorts: 2, maxWait: 60 });
  const p = pkg();

  assert.equal(
    assemble(p, freeze({ formed: 9, escorts: 4 }), 110, limits),
    true,
    "a fully formed package goes at once",
  );
  assert.equal(
    assemble(p, freeze({ formed: 3, escorts: 1 }), 130, limits),
    false,
    "before the deadline a half-formed package keeps waiting",
  );
  assert.equal(
    assemble(p, freeze({ formed: 5, escorts: 0 }), 160, limits),
    true,
    "at the deadline a package short of escorts goes with the escorts on hand",
  );
  assert.equal(
    assemble(p, freeze({ formed: 2, escorts: 0 }), 200, limits),
    false,
    "at the deadline a package short of strikers stands down",
  );
  assert.equal(
    assemble(p, freeze({ formed: 2, escorts: 0 }), 100000, limits),
    false,
    "a stood-down shape never launches however long it is asked",
  );
}

// 3 — an escort stays under no local threat; every separation states a reason.
{
  const p = pkg();
  const escort = freeze({ id: "f1" });

  const staying = escortDecision(escort, p, false, 1);
  assert.equal(staying.stay, true, "no threat, orders or fuel problem means the escort stays");
  assert.ok(staying.reason.length > 0, "staying must still explain itself");

  const threat = escortDecision(escort, p, true, 1);
  assert.equal(threat.stay, false, "a local threat justifies separation");
  assert.ok(threat.reason.length > 0, "separation must carry a reason");

  const detached = escortDecision(freeze({ id: "f1", detached: true }), p, false, 1);
  assert.equal(detached.stay, false, "an order justifies separation");

  const dry = escortDecision(escort, p, false, 0.05);
  assert.equal(dry.stay, false, "fuel too low to hold station justifies separation");
  assert.ok(dry.reason.length > 0, "the fuel separation must carry a reason");

  assert.notEqual(threat.reason, dry.reason, "different separation causes read differently");
  assert.notEqual(detached.reason, dry.reason, "different separation causes read differently");
}

// 4 — abortCriteria fires on inadequate fuel and on a stale contact, each with its own reason.
{
  const p = pkg({ phase: "outbound" });

  const fuel = abortCriteria(p, 0.05, 30, 0.1);
  assert.ok(fuel && fuel.abort, "inadequate fuel must abort");
  assert.equal(fuel.reason, "inadequate fuel", `fuel abort reason, got ${fuel.reason}`);

  const stale = abortCriteria(p, 1, STALE_SECONDS + 1, 0.1);
  assert.ok(stale && stale.abort, "a stale contact must abort");
  assert.equal(stale.reason, "stale contact", `stale abort reason, got ${stale.reason}`);

  assert.notEqual(fuel.reason, stale.reason, "fuel and stale are separate reasons");

  const threatened = abortCriteria(p, 1, 30, 0.9);
  assert.ok(threatened && threatened.abort, "an unusable approach must abort");
  assert.equal(threatened.reason, "unusable approach", `threat abort reason, got ${threatened.reason}`);

  assert.equal(abortCriteria(p, 1, 30, 0.1), null, "a flyable approach returns null, not a false abort");
  assert.equal(
    abortCriteria(pkg({ phase: "returning" }), 0.01, STALE_SECONDS + 100, 1),
    null,
    "a package already returning has no further abort decision",
  );
}

// 5 — the Kate loadout: bombs for an island, torpedoes for an identified ship, null without stores.
{
  const island = freeze({ kind: "island", identified: false });
  const ship = freeze({ kind: "ship", identified: true });

  assert.equal(kateLoadout(island, freeze({ torpedo: 5, bomb: 5 })), "bomb", "an island is bombed");
  assert.equal(kateLoadout(ship, freeze({ torpedo: 5, bomb: 5 })), "torpedo", "an identified ship can justify torpedoes");
  assert.equal(kateLoadout(ship, freeze({ torpedo: 0, bomb: 5 })), "bomb", "without torpedoes the Kate still level-bombs");
  assert.equal(kateLoadout(island, freeze({ torpedo: 5, bomb: 0 })), null, "an island with no bombs is not worth a torpedo");
  assert.equal(kateLoadout(ship, freeze({ torpedo: 0, bomb: 0 })), null, "no stores means no loadout");

  const never = [kateLoadout(island, freeze({ torpedo: 5, bomb: 5 })), kateLoadout(ship, freeze({ torpedo: 5, bomb: 5 }))];
  assert.ok(never.every((l) => l === "torpedo" || l === "bomb"), "a Kate never gets a dive-bombing loadout");
}

// 6 — purity: every input frozen, nothing throws, repeated calls agree.
{
  const available = freeze({ groupId: "g1", strikers: 9, escorts: 4, at: 100 });
  assert.doesNotThrow(() => composePackage(available, contact, doctrine), "composePackage must not mutate its inputs");
  assert.deepEqual(
    composePackage(available, contact, doctrine),
    composePackage(available, contact, doctrine),
    "composePackage must be repeatable",
  );

  const p = pkg();
  const limits = freeze({ minStrikers: 4, minEscorts: 2, maxWait: 60 });
  assert.doesNotThrow(() => assemble(p, freeze({ formed: 5, escorts: 0 }), 160, limits), "assemble must not mutate its inputs");
  assert.equal(assemble(p, freeze({ formed: 5, escorts: 0 }), 160, limits), assemble(p, freeze({ formed: 5, escorts: 0 }), 160, limits), "assemble must be repeatable");

  const escort = freeze({ id: "f1" });
  assert.doesNotThrow(() => escortDecision(escort, p, false, 1), "escortDecision must not mutate its inputs");
  assert.deepEqual(escortDecision(escort, p, false, 1), escortDecision(escort, p, false, 1), "escortDecision must be repeatable");

  const outbound = pkg({ phase: "outbound" });
  assert.doesNotThrow(() => abortCriteria(outbound, 0.05, 30, 0.1), "abortCriteria must not mutate its inputs");
  assert.deepEqual(abortCriteria(outbound, 0.05, 30, 0.1), abortCriteria(outbound, 0.05, 30, 0.1), "abortCriteria must be repeatable");

  const target = freeze({ kind: "ship", identified: true });
  const stores = freeze({ torpedo: 5, bomb: 5 });
  assert.doesNotThrow(() => kateLoadout(target, stores), "kateLoadout must not mutate its inputs");
  assert.equal(kateLoadout(target, stores), kateLoadout(target, stores), "kateLoadout must be repeatable");
}

console.log("check-airgroup: all assertions passed");
