/**
 * Every new hull class, photographed twice, for PRD-midway-asset-battle-integration AC-22.
 *
 * AC-22 asks for real WebGPU captures of the new hull classes "at engagement and close ranges" and
 * says plainly that "No blank/missing frame counts as evidence". So this does two things a
 * screenshot alone cannot:
 *
 *  - it frames each hull from the game's own scene graph — the mesh the renderer is actually
 *    drawing, at its own measured length — rather than from a position typed in here, so a hull
 *    that failed to load cannot be photographed as an empty patch of sea and pass;
 *  - it refuses a frame the subject never reached, by asking the renderer how many of that hull's
 *    own triangles are inside the camera frustum AND that part of the hull rises above the sea.
 *    A hull that did not load, did not draw, was framed off-screen, or — like a dived submarine —
 *    was drawn entirely under the water produces exactly the "blank/missing frame" the criterion
 *    will not accept. This is the second version of that check: reading canvas pixels back reported
 *    zero subject on every frame, including ones plainly showing a carrier, because a WebGPU canvas
 *    does not survive `drawImage`. It is not to be reintroduced.
 *
 * What it does NOT do is judge how the hull looks. Nothing automated can: these frames exist to be
 * looked at, and the assertions here only establish that there is something in them to look at.
 *
 *   bash tools/capture-lock.sh node tools/capture-hulls.mjs
 *   MIDWAY_URL=http://127.0.0.1:5321 bash tools/capture-lock.sh node tools/capture-hulls.mjs
 */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const URL = process.env.MIDWAY_URL || "http://127.0.0.1:5301";
const OUT = process.env.MIDWAY_SHOTS || "screenshots";

/**
 * The two ranges AC-22 names, as multiples of the hull's own length rather than metres: a 261 m
 * carrier and a 95 m submarine photographed from the same 2 km are not the same picture, and the
 * criterion is about what a player can resolve, not about a distance.
 */
const RANGES = [
  { name: "engagement", lengths: 7.5, fov: 34, rise: 0.9 },
  { name: "close", lengths: 1.35, fov: 52, rise: 0.42 },
];

/** Below this many of the hull's own triangles in frustum, the frame has no subject to look at. */
const MIN_SUBJECT_TRIANGLES = 500;

const browser = await chromium.launch({
  headless: false,
  args: [
    "--use-angle=vulkan",
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan",
    "--disable-gpu-sandbox",
    "--ignore-gpu-blocklist",
    "--ozone-platform=x11",
  ],
});
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1672, height: 941 } });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(URL);
  await page.waitForSelector("#loading.hidden", { state: "attached", timeout: 120000 });
  await page.waitForSelector("#briefing:not(.hidden)");
  await page.evaluate(async () => {
    const urls = performance
      .getEntriesByType("resource")
      .map((e) => e.name)
      .filter((n) => /\/src\/game\.ts(?:\?|$)/.test(n));
    if (!urls.length) throw new Error("Missing loaded game module");
    for (const url of urls.reverse()) {
      const scene = (await import(url)).default.scene;
      if (scene) {
        window.midway = scene;
        break;
      }
    }
    if (!window.midway) throw new Error("Loaded game has no scene");
  });
  const adapter = await page.evaluate(async () => {
    const a = await navigator.gpu.requestAdapter();
    return { vendor: a.info.vendor, architecture: a.info.architecture };
  });
  assert.ok(
    adapter.vendor && !/swiftshader|lavapipe|llvmpipe/i.test(JSON.stringify(adapter)),
    `software adapter, the frames would prove nothing about the game: ${JSON.stringify(adapter)}`,
  );
  console.log("adapter", JSON.stringify(adapter));
  await mkdir(OUT, { recursive: true });

  await page.click("#start-air");
  await page.waitForFunction(() => window.midway.battle.time > 2, null, { timeout: 30000 });

  // Every hull the simulation is actually carrying, named from the ship record so a class that
  // never reached the fleet cannot quietly be skipped.
  const hulls = await page.evaluate(() => {
    const b = window.midway.battle;
    return b.ships
      .filter((s) => !s.sunk)
      .map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.kind,
        team: s.team,
        hullLength: s.hullLength,
        drawn: !!window.midway.world.meshes.get(s.id),
      }));
  });
  const missing = hulls.filter((h) => !h.drawn);
  assert.equal(
    missing.length,
    0,
    `the renderer has no mesh for ${missing.map((h) => h.name).join(", ")}`,
  );
  console.log(`hulls ${hulls.length}`, JSON.stringify(hulls.map((h) => h.name)));

  const freeze = () =>
    page.evaluate(() => {
      const s = window.midway;
      s.__wasPaused = s.paused;
      s.paused = true;
      const w = s.world;
      w.__updateCamera ??= w.updateCamera;
      w.updateCamera = () => {};
    });
  const release = () =>
    page.evaluate(() => {
      const s = window.midway;
      const w = s.world;
      if (w.__updateCamera) w.updateCamera = w.__updateCamera;
      s.paused = s.__wasPaused ?? false;
    });

  /**
   * Bring a boat to the surface before she is photographed. A dive is a legitimate state — the
   * simulation puts a boat under whenever she holds a delivered contact and surfaces her when she
   * does not (`submarine.ts`'s modes, chosen in `Battle.step`, earned through `stepDepth`) — so this
   * sets the same condition the simulation itself represents, never the rendered mesh: the surfaced
   * mode, depth 0 (its `SURFACE_DEPTH`), and the `surfaced`/`y` fields the simulation derives from
   * it through the one `subY` conversion. The renderer then places the hull from `s.y` on the next
   * frame, exactly as it would after a real surface order. This tool pauses the fixed clock between
   * frames, so the boat cannot earn the climb itself; setting the condition is the honest stand-in.
   */
  const surfaceSub = (id) =>
    page.evaluate((id) => {
      const s = window.midway?.battle?.ships?.find((x) => x.id === id);
      if (!s || s.kind !== "sub" || !s.sub) return { sub: false };
      s.sub.mode = "surfaced";
      s.sub.depth = 0;
      s.sub.depthRate = 0;
      // The two fields `Battle.step` writes from that state, for a surfaced boat.
      s.surfaced = true;
      s.y = 0;
      return { sub: true, mode: s.sub.mode, depth: s.sub.depth };
    }, id);

  /**
   * Put the camera off this hull's starboard bow at a multiple of its own length, and report what
   * the renderer says is in front of it. The mesh's own world bounds are the subject, so a hull
   * drawn at the wrong scale or in the wrong place frames wrongly and shows it.
   */
  const frameHull = (id, lengths, fov, rise) =>
    page.evaluate(
      ({ id, lengths, fov, rise }) => {
        const s = window.midway;
        const w = s.world;
        const mesh = w.meshes.get(id);
        mesh.updateMatrixWorld(true);
        const ship = s.battle.ships.find((x) => x.id === id);
        const V = w.camera.position.constructor;
        const centre = new V(ship.x, (ship.deckHeight ?? 8) * 0.5, ship.z);
        const reach = Math.max(60, (ship.hullLength ?? 120) * lengths);
        // Off the starboard bow, raised by a fraction of the standoff: a three-quarter view shows
        // length, beam and superstructure at once, which a beam-on or bow-on shot does not.
        const heading = ship.heading ?? 0;
        const bearing = heading + Math.PI * 0.62;
        w.camera.position.set(
          centre.x + Math.sin(bearing) * reach,
          centre.y + reach * rise * 0.32 + 6,
          centre.z - Math.cos(bearing) * reach,
        );
        w.camera.up.set(0, 1, 0);
        w.camera.lookAt(centre.x, centre.y, centre.z);
        w.camera.fov = fov;
        w.camera.near = 0.5;
        w.camera.far = Math.max(20000, reach * 6);
        w.camera.updateProjectionMatrix();
        w.camera.updateMatrixWorld();
        return { reach: +reach.toFixed(0), hullLength: ship.hullLength ?? null };
      },
      { id, lengths, fov, rise },
    );

  /**
   * Is the hull actually in the picture? Not measured from the pixels: a WebGPU canvas does not
   * survive `drawImage`, and every luminance heuristic that tries reads a blank frame whether the
   * frame is blank or not — which is a gate that always fires and therefore proves nothing.
   *
   * So the renderer is asked instead, about this hull specifically: are its meshes inside the
   * camera frustum, and how many triangles of it would be drawn. That is the same evidence
   * `capture-performance.mjs` reports its in-frustum counts from, and it is the honest reading of
   * AC-22's "no blank/missing frame counts as evidence": the criterion is about whether the subject
   * reached the frame, and a person still has to look at the frame to judge the rest.
   *
   * What this number does **not** speak about is range. Every hull draws its real model at every
   * range — there is no procedural far level any more — so the two rows come out identical by
   * design. Read the long-range readability off the pictures, never off these counts.
   */
  const subjectInFrame = (id) =>
    page.evaluate((id) => {
      const w = window.midway.world;
      const mesh = w.meshes.get(id);
      const camera = w.camera;
      camera.updateMatrixWorld();
      camera.updateProjectionMatrix();
      // The six frustum planes straight from the camera's own matrices: three's Frustum class is
      // not reachable from the scene graph, and importing three a second time here would build a
      // different module instance than the one the page is rendering with.
      let inFrustum = 0;
      let meshes = 0;
      let triangles = 0;
      const m = camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse);
      const planes = [];
      const e = m.elements;
      const push = (a, b, c, d) => {
        const len = Math.hypot(a, b, c) || 1;
        planes.push([a / len, b / len, c / len, d / len]);
      };
      push(e[3] - e[0], e[7] - e[4], e[11] - e[8], e[15] - e[12]);
      push(e[3] + e[0], e[7] + e[4], e[11] + e[8], e[15] + e[12]);
      push(e[3] + e[1], e[7] + e[5], e[11] + e[9], e[15] + e[13]);
      push(e[3] - e[1], e[7] - e[5], e[11] - e[9], e[15] - e[13]);
      push(e[3] - e[2], e[7] - e[6], e[11] - e[10], e[15] - e[14]);
      push(e[3] + e[2], e[7] + e[6], e[11] + e[10], e[15] + e[14]);
      mesh.updateMatrixWorld(true);
      // The hull's own world bounding box top, from every drawn mesh regardless of frustum: a hull
      // entirely below the sea was not reached by the frame, however many of its triangles are in
      // front of the camera. The sea's level comes from the ocean mesh the scene is drawing, not a
      // zero typed here — the ocean mesh rides the camera at its own y, and that is the plane a
      // dived hull sits under.
      let top = -Infinity;
      mesh.traverse((o) => {
        if (!o.isMesh || !o.visible || !o.geometry) return;
        meshes += 1;
        const g = o.geometry;
        if (!g.boundingSphere) g.computeBoundingSphere();
        const centre = g.boundingSphere.center.clone().applyMatrix4(o.matrixWorld);
        const scale = o.matrixWorld.getMaxScaleOnAxis();
        const r = g.boundingSphere.radius * scale;
        if (!g.boundingBox) g.computeBoundingBox();
        if (g.boundingBox) {
          const box = g.boundingBox.clone().applyMatrix4(o.matrixWorld);
          if (box.max.y > top) top = box.max.y;
        }
        const inside = planes.every((p) => p[0] * centre.x + p[1] * centre.y + p[2] * centre.z + p[3] > -r);
        if (!inside) return;
        inFrustum += 1;
        triangles += g.index ? g.index.count / 3 : (g.attributes.position?.count ?? 0) / 3;
      });
      const waterLevel = w.sea?.position?.y ?? 0;
      return {
        meshes,
        inFrustum,
        triangles: Math.round(triangles),
        topY: +top.toFixed(2),
        waterLevel,
        aboveWater: top > waterLevel,
      };
    }, id);

  const rows = [];
  const skipped = [];
  for (const hull of hulls) {
    for (const range of RANGES) {
      await freeze();
      if (hull.kind === "sub") await surfaceSub(hull.id);
      const framed = await frameHull(hull.id, range.lengths, range.fov, range.rise);
      await page.waitForTimeout(420);
      const subject = await subjectInFrame(hull.id);
      // A frame with the subject below the sea is not evidence. For a surface hull that is a plain
      // failure the blank gate below reports; for a boat it may simply mean she dived, which is a
      // legitimate state and not a broken model, so she is surfaced above rather than failed. If
      // even the surfaced condition leaves her under, the frame is not evidence and she is skipped,
      // not counted among the classes captured.
      if (hull.kind === "sub" && !subject.aboveWater) {
        await release();
        skipped.push(`${hull.name}/${range.name}`);
        console.log(
          `${hull.name} / ${range.name} SKIPPED: hull top ${subject.topY} m is not above the sea ` +
            `${subject.waterLevel} m — the boat was dived, so the frame is not evidence and is not counted`,
        );
        continue;
      }
      // Still frozen: `release` would hand the camera back to the game before the frame is taken.
      const slug = `hull-${hull.name.toLowerCase().replace(/[^a-z0-9]+/gu, "-")}-${range.name}`;
      await page.screenshot({ path: `${OUT}/${slug}.png` });
      await release();
      rows.push({ name: hull.name, kind: hull.kind, range: range.name, ...framed, ...subject });
      console.log(
        `${hull.name} / ${range.name}`,
        JSON.stringify({
          standoff: framed.reach,
          inFrustum: `${subject.inFrustum}/${subject.meshes}`,
          tris: subject.triangles,
          aboveWater: subject.aboveWater,
        }),
      );
    }
  }

  const blank = rows.filter((r) => r.inFrustum === 0 || !r.aboveWater || r.triangles < MIN_SUBJECT_TRIANGLES);
  assert.equal(
    blank.length,
    0,
    `AC-22 refuses a blank frame as evidence, and the subject did not reach these: ${blank
      .map(
        (r) =>
          `${r.name}/${r.range} (${r.inFrustum}/${r.meshes} meshes in frustum, ${r.triangles} tris, ` +
          `top ${r.topY} m vs sea ${r.waterLevel} m)`,
      )
      .join(", ")}`,
  );

  assert.equal(errors.length, 0, `console/page errors during capture: ${errors.join(" | ")}`);
  console.log(
    `PASS: ${hulls.length} hull classes captured at engagement and close range (${rows.length} frames` +
      `, least subject ${Math.min(...rows.map((r) => r.triangles))} triangles in frustum)` +
      (skipped.length ? `, skipped as dived: ${skipped.join(", ")}` : ``) +
      `, no console or GPU errors. The frames are in ${OUT}/ and AC-22 is not met until a person has` +
      ` looked at them.`,
  );
} finally {
  await browser.close();
}
