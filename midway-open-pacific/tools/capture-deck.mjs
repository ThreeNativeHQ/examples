/**
 * The deck-scale question, answered in the view rather than in a table.
 *
 * The recurring complaint is that the flight deck looks too narrow beside the aircraft, and a
 * dimensions table cannot settle that. This raycasts the carrier's own geometry across the beam
 * at the stations the aircraft actually occupies, reports the width it finds in Douglas
 * wingspans, and captures the briefing, the launch point, the deck run and the moment after
 * liftoff from the player's own camera so the framing can be judged.
 *
 * The second pass answers PRD-midway-asset-battle-integration AC-2 for the imported hulls: every
 * carrier in tools/blender/fleet.json is raycast at named centreline stations and at its corridor
 * edges, and the measured deck elevation, keel and weapon collision locations are held to 0.1 m
 * against the datum, the ocean plane and the collision volume the game itself uses. One frame per
 * hull lands beside the launch captures, because none of those numbers say how the deck looks.
 */
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright";

const URL = process.env.MIDWAY_URL || "http://127.0.0.1:5198";
const OUT = process.env.MIDWAY_SHOTS || "screenshots";
const SPAN = 12.66;

const browser = await chromium.launch({
  headless: false,
  args: [
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
    // Newest first, but the newest is not always the live one: an edit anywhere in the import graph
    // gives Vite a second `game.ts?t=…`, and re-importing that builds a fresh game that was never
    // started, whose `scene` is undefined. The running game is the one that has a battle.
    const urls = performance
      .getEntriesByType("resource")
      .map((e) => e.name)
      .filter((n) => /\/src\/game\.ts(?:\?|$)/.test(n))
      .reverse();
    for (const url of urls) {
      const scene = (await import(url)).default.scene;
      if (scene?.battle) {
        window.midway = scene;
        return;
      }
    }
    throw new Error(`No loaded game module holds a running scene; tried ${urls.length}: ${urls.join(", ")}`);
  });
  await mkdir(OUT, { recursive: true });

  // Borrow Three from the bundle the page already loaded; a second copy would not share classes.
  const three = await page.evaluate(async () => {
    // Names vary with Vite's dep pre-bundling, so pick by what a module exports, not what it is
    // called: the first already-loaded module that actually has Raycaster is Three itself.
    const urls = performance
      .getEntriesByType("resource")
      .map((e) => e.name)
      .filter((n) => /\.js(\?|$)/.test(n) && /three/i.test(n));
    for (const url of urls) {
      try {
        const mod = await import(url);
        if (mod.Raycaster && mod.Vector3) {
          window.__T = mod;
          return url;
        }
      } catch {
        // A module that will not re-import is simply not the one we need.
      }
    }
    throw new Error(`No loaded module exports Raycaster; tried ${urls.length}: ${urls.join(", ")}`);
  });
  console.log("three module", three);

  // Walk inboard from well outboard until the ray lands on the flight deck surface.
  const report = await page.evaluate((span) => {
    const s = window.midway;
    const T = window.__T;
    const home = s.battle.home;
    const mesh = s.world.meshes.get(home.id);
    const lod = mesh.children[0];
    const detailed = lod.levels ? lod.levels[0].object : lod;
    detailed.updateMatrixWorld(true);
    // Rays are cast in world space, but the stations are named in the ship's own frame and the
    // ship is kilometres away under a heading, so both ends of the ray go through its matrix.
    const down = new T.Vector3(0, -1, 0).transformDirection(mesh.matrixWorld).normalize();
    const deckAt = (probeZ) => {
      const edges = [];
      for (const sign of [-1, 1]) {
        let edge = null;
        for (let x = sign * 40; Math.abs(x) > 0.4; x -= sign * 0.2) {
          const from = new T.Vector3(x, 70, probeZ).applyMatrix4(mesh.matrixWorld);
          const hit = new T.Raycaster(from, down).intersectObject(detailed, true)[0];
          if (!hit) continue;
          // The flight deck sits at 20.06 in the ship's frame; above is the island, below is
          // the hangar deck and the sponsons.
          const local = mesh.worldToLocal(hit.point.clone());
          if (local.y > 19 && local.y < 21.5) {
            edge = +x.toFixed(2);
            break;
          }
        }
        edges.push(edge);
      }
      const [port, starboard] = edges;
      const width = port !== null && starboard !== null ? starboard - port : null;
      return {
        localZ: probeZ,
        port,
        starboard,
        width: width === null ? null : +width.toFixed(2),
        spans: width === null ? null : +(width / span).toFixed(2),
      };
    };
    // Briefing pose, the launch start, mid deck run and the bow.
    return [15, -20, -55, -90, 55, 78, 100, 118].map(deckAt);
  }, SPAN);
  console.log("deck width by station", JSON.stringify(report));
  const usable = report.filter((r) => r.width !== null);
  assert.ok(usable.length >= 6, `the deck was found at most stations: ${JSON.stringify(report)}`);
  for (const row of usable)
    assert.ok(
      row.spans > 1.6,
      `the deck is at least 1.6 Douglas spans wide at z=${row.localZ}: ${JSON.stringify(row)}`,
    );

  // Where the aircraft and the parked deck park actually sit across that width.
  const layout = await page.evaluate(() => {
    const s = window.midway;
    const mesh = s.world.meshes.get(s.battle.home.id);
    const parked = (mesh.userData.parked ?? []).map((p) => ({
      x: +p.position.x.toFixed(2),
      z: +p.position.z.toFixed(2),
      visible: p.visible,
    }));
    return {
      player: {
        x: +s.world.playerMesh.position.x.toFixed(2),
        z: +s.world.playerMesh.position.z.toFixed(2),
      },
      crewAnchor: +s.world.crewAnchor.toFixed(2),
      parked,
    };
  });
  console.log("deck layout", JSON.stringify(layout));

  await page.screenshot({ path: `${OUT}/deck-briefing.png` });
  await page.click("#start-deck");
  const seconds = async (n) => {
    const t = await page.evaluate(() => window.midway.battle.time);
    await page.waitForFunction((u) => window.midway.battle.time >= u, t + n, {
      timeout: Math.max(20000, n * 4000),
    });
  };
  await seconds(0.6);
  await page.screenshot({ path: `${OUT}/deck-launchpoint.png` });

  await page.keyboard.down("KeyW");
  await seconds(7);
  await page.screenshot({ path: `${OUT}/deck-run.png` });
  await seconds(8);
  await page.keyboard.up("KeyW");
  await page.keyboard.down("ArrowDown");
  await seconds(1);
  await page.keyboard.up("ArrowDown");
  await seconds(2.5);
  await page.screenshot({ path: `${OUT}/deck-liftoff.png` });
  const off = await page.evaluate(() => {
    const p = window.midway.battle.player;
    return {
      mode: p.mode,
      y: +p.y.toFixed(2),
      speed: +p.speed.toFixed(1),
      stall: +p.stall.toFixed(3),
    };
  });
  console.log("launch", JSON.stringify(off));
  assert.equal(off.mode, "flight", `the aircraft leaves the deck: ${JSON.stringify(off)}`);
  assert.ok(off.y > 22, `and climbs away rather than settling back: ${JSON.stringify(off)}`);

  // A low pass, which is the altitude the exterior water reference was shot at.
  await page.evaluate(() => {
    const p = window.midway.battle.player;
    Object.assign(p, { y: 92 });
  });
  await seconds(2);
  await page.screenshot({ path: `${OUT}/deck-lowwater.png` });
  const low = await page.evaluate(() => ({
    y: +window.midway.battle.player.y.toFixed(1),
    speed: +window.midway.battle.player.speed.toFixed(1),
  }));
  console.log("low pass", JSON.stringify(low));


  // ───────────────────────────────────────────────────────────────────────────────────────────
  // Every imported carrier's own geometry against the numbers the game believes (AC-2).
  //
  // The catalog and the fleet table already agree with each other; what nothing proved is that the
  // shipped triangles agree with them. So for each carrier in tools/blender/fleet.json this walks
  // the hull the game actually loaded: the deck elevation and the corridor edges at named stations
  // on the centreline, the keel against the ocean's own mean plane, and a weapon at the measured
  // deck edge against the collision volume the bomb path really tests.
  //
  // No game number is restated here. The deck datum comes from `DECKS`, the beam from
  // `SHIP_CLASSES`, the collision box from the live ship record, the sea level from the ocean mesh
  // and the hit test from `onDeck` with the margin the bomb path passes it.
  const carriers = JSON.parse(await readFile(`${import.meta.dirname}/blender/fleet.json`, "utf8"))
    .ships.filter((s) => s.id.startsWith("carrier."))
    .map((s) => s.id.slice("carrier.".length));
  console.log("fleet.json carriers", carriers.join(", "));

  // Vite serves every source file separately in dev, so the game's own modules can be re-imported
  // by URL and asked for the numbers it uses, rather than having them copied in here.
  await page.evaluate(() => {
    window.__staged = [];
    window.__mod = async (path) => {
      const url = performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .findLast((n) => n.includes(path));
      if (!url) throw new Error(`module not loaded: ${path}`);
      return import(url);
    };
  });

  // Make sure the shipped hulls are in the game's own asset cache before asking it for a model.
  // `loadImportedHulls` is idempotent — ctx.assets owns the cache — so this is a no-op once the
  // scene's own `load` calls it, and it keeps the survey honest in the meantime: every hull measured
  // here is loaded by the game's loader, through the game's ctx, from the bytes the game ships.
  console.log(
    "imported hulls",
    await page.evaluate(async () => {
      const fleet = await window.__mod("/src/render/imported-fleet.ts");
      const ctx = window.midway.ctx;
      if (!fleet.loadImportedHulls) return "no loadImportedHulls export";
      if (!ctx) return "the scene exposes no ctx";
      await fleet.loadImportedHulls(ctx);
      return "loaded through the game's own loader";
    }),
  );

  const TOL = 0.1; // m; AC-2's agreement bound.
  const hulls = [];
  // Every disagreement, not just the first. A run that stops at station one hides the other ten,
  // and the frames a person has to look at are captured after the survey; the gate still fails,
  // it just fails with the whole finding in hand.
  const disagreements = [];
  const agree = (ok, message) => {
    if (!ok) {
      disagreements.push(message);
      console.log(`DISAGREEMENT ${message}`);
    }
  };

  for (const [index, classId] of carriers.entries()) {
    // Clear water between the two task forces, for a hull the battle does not place itself.
    const stage = { x: 3000 + index * 1200, z: 4000, heading: 0 };
    const hull = await page.evaluate(
      async ({ classId, stage }) => {
        const T = window.__T;
        const view = window.midway.world;
        const battle = window.midway.battle;
        const ships = await window.__mod("/src/render/imported-ships.ts");
        const catalog = await window.__mod("/src/sim/catalog.ts");
        const { onDeck, overHull } = await window.__mod("/src/sim/math.ts");
        const cls = catalog.shipClass(classId);

        // Which live ship draws this hull: ask the game's own classId-to-model dispatch for the
        // name it gives the model, then look for that name among the meshes the world built.
        // Matching on the game's own naming survives a re-import that moves every dimension.
        const probe = ships.shipModelFor(classId);
        const detailedOf = (mesh) => {
          const lod = mesh?.children?.[0];
          return lod?.levels ? lod.levels[0].object : lod;
        };
        const ship = battle.ships.find((s) => detailedOf(view.meshes.get(s.id))?.name === probe.name);
        // The datum the game uses, from the record the game keeps it in: `Battle` resolves every
        // carrier's deck through `shipGeometry` onto the ship itself, and `DECKS` in imported-ships
        // is the render-side mirror of that table which the two files' comments say must stay equal.
        const renderDatum = ships.DECKS?.[classId]?.height ?? null;
        const datumHeight = ship ? ship.deckHeight : renderDatum;
        if (typeof datumHeight !== "number")
          throw new Error(`nothing in the game holds a deck datum for ${classId}`);
        let root;
        let detailed;
        if (ship) {
          root = view.meshes.get(ship.id);
          detailed = detailedOf(root);
        } else {
          // Nothing in the battle draws it. Stage the game's own instance the way WorldView places
          // a hull — origin at the sim position, y = 0 — so the geometry can still be measured, and
          // say so: an unplaced hull has no collision volume for a weapon to be tested against.
          root = new T.Group();
          root.position.set(stage.x, 0, stage.z);
          root.rotation.y = -stage.heading;
          root.add(probe);
          view.scene.add(root);
          detailed = probe;
          window.__staged.push(root);
        }
        root.updateMatrixWorld(true);

        // The hull's own box, in its own frame. A world Box3 cannot serve: the world gives every
        // ship a few milliradians of bob, which is half a metre of Y at the bow — five times
        // AC-2's bound — and Box3.applyMatrix4 on a rotated box inflates it rather than inverting.
        const inv = new T.Matrix4().copy(detailed.matrixWorld).invert();
        const box = new T.Box3();
        const v = new T.Vector3();
        const m = new T.Matrix4();
        detailed.traverse((n) => {
          if (!n.isMesh || !n.geometry?.attributes?.position) return;
          m.multiplyMatrices(inv, n.matrixWorld);
          const pos = n.geometry.attributes.position;
          for (let i = 0; i < pos.count; i += 1)
            box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(m));
        });

        // A parked aircraft is not the flight deck. The world adds the deck park as a child of the
        // hull, so a station under a wing would otherwise report the wing as the deck.
        const parked = new Set(root.userData.parked ?? []);
        const onHull = (object) => {
          for (let o = object; o; o = o.parent) if (parked.has(o)) return false;
          return true;
        };
        const ceiling = box.max.y + 20;
        const down = new T.Vector3(0, -1, 0).transformDirection(detailed.matrixWorld).normalize();
        // The topmost hull surface under a point of the hull's own frame, in that same frame. Rays
        // are cast in world space, so both ends go through the hull's matrix.
        const surfaceAt = (x, z) => {
          const from = new T.Vector3(x, ceiling, z).applyMatrix4(detailed.matrixWorld);
          const hit = new T.Raycaster(from, down)
            .intersectObject(detailed, true)
            .find((h) => onHull(h.object));
          return hit ? +detailed.worldToLocal(hit.point.clone()).y.toFixed(3) : null;
        };

        const length = box.max.z - box.min.z;
        const start = cls.measuredBeam / 2 + 5;
        // Named on the centreline as a fraction of the hull's own length, so the same stations mean
        // the same places on a 227 m hull and a 247 m one, and both ends are covered whichever way
        // the bow points.
        const stations = [-0.4, -0.2, 0, 0.2, 0.4].map((f) => {
          const z = box.min.z + (0.5 + f) * length;
          const deckY = surfaceAt(0, z);
          const row = {
            station: `${f >= 0 ? "+" : ""}${f.toFixed(2)}L`,
            z: +z.toFixed(2),
            deckY,
            port: null,
            starboard: null,
            width: null,
            edge: [],
          };
          if (deckY === null) return row;
          // The same deck this station sits on, judged against the station's own centreline
          // elevation — never against the datum under test.
          const atDeck = (x) => {
            const y = surfaceAt(x, z);
            return y !== null && Math.abs(y - deckY) <= 0.75 ? y : null;
          };
          for (const sign of [-1, 1]) {
            // Walk inboard in 1 m steps to the outermost deck-level surface, then bisect the last
            // metre to 0.1 m. A flat 0.2 m walk costs five times the rays, and the Yorktown ships
            // as a single 200k-triangle mesh, so every ray tests all of it.
            let miss = sign * start;
            let hit = null;
            for (let x = miss; Math.abs(x) > 0.4; x -= sign) {
              if (atDeck(x) !== null) {
                hit = x;
                break;
              }
              miss = x;
            }
            if (hit === null) continue;
            while (Math.abs(hit - miss) > 0.1) {
              const mid = (hit + miss) / 2;
              if (atDeck(mid) !== null) hit = mid;
              else miss = mid;
            }
            const y = atDeck(hit);
            const side = sign < 0 ? "port" : "starboard";
            const at = detailed.localToWorld(new T.Vector3(hit, y, z));
            // The bomb path tests onDeck(point, ship, 3); one hull beam outboard must miss.
            const out = detailed.localToWorld(new T.Vector3(hit + sign * cls.hullBeam, y, z));
            row[side] = +hit.toFixed(2);
            row.edge.push({
              side,
              x: +hit.toFixed(2),
              deckY: y,
              // `overHull` with margin 3 is the test the bomb path itself runs against a ship.
              inside: ship ? overHull(at, ship, 3) : null,
              outboardHits: ship ? overHull(out, ship, 3) : null,
              // Reported, never asserted: the launch corridor is deliberately narrower than the
              // deck a bomb can land on, so an edge outside it is a decision, not a defect.
              inCorridor: ship ? onDeck(at, ship, 0) : null,
            });
          }
          if (row.port !== null && row.starboard !== null) row.width = +(row.starboard - row.port).toFixed(2);
          return row;
        });

        return {
          classId,
          model: probe.name,
          shipName: ship?.name ?? null,
          shipBox: ship
            ? {
                hullLength: ship.hullLength,
                hullBeam: ship.hullBeam,
                deckLength: ship.deckLength,
                deckWidth: ship.deckWidth,
                deckHeight: ship.deckHeight,
              }
            : null,
          datumHeight,
          renderDatum,
          hullBeam: cls.hullBeam,
          keelLocal: +box.min.y.toFixed(3),
          keelWorld: +(root.position.y + box.min.y).toFixed(3),
          seaY: view.sea.getWorldPosition(new T.Vector3()).y,
          measured: {
            length: +length.toFixed(2),
            beam: +(box.max.x - box.min.x).toFixed(2),
            height: +(box.max.y - box.min.y).toFixed(2),
          },
          shipId: ship?.id ?? null,
          origin: { x: root.position.x, z: root.position.z, heading: ship?.heading ?? stage.heading },
          stations,
        };
      },
      { classId, stage },
    );
    hulls.push(hull);
    console.log(`hull ${hull.classId}`, JSON.stringify(hull));

    agree(
      hull.renderDatum === null || hull.renderDatum === hull.datumHeight,
      `${hull.classId}: the render-side DECKS datum (${hull.renderDatum} m) and the datum the sim keeps on the ship ` +
        `(${hull.datumHeight} m) have drifted apart, and both files say they must stay equal`,
    );
    const found = hull.stations.filter((r) => r.deckY !== null);
    agree(
      found.length >= 3,
      `${hull.classId}: the flight deck was found at only ${found.length} of ${hull.stations.length} centreline stations`,
    );
    for (const row of found)
      agree(
        Math.abs(row.deckY - hull.datumHeight) <= TOL,
        `${hull.classId}: the deck at ${row.station} measures ${row.deckY} m against the ${hull.datumHeight} m datum ` +
          `the game uses, off by ${Math.abs(row.deckY - hull.datumHeight).toFixed(3)} m (bound ${TOL} m)`,
      );
    agree(
      Math.abs(hull.keelLocal) <= TOL,
      `${hull.classId}: the keel is ${hull.keelLocal} m in the shipped model, not the y = 0 the import contract states`,
    );
    agree(
      Math.abs(hull.keelWorld - hull.seaY) <= TOL,
      `${hull.classId}: the keel lands at ${hull.keelWorld} m where the game floats the hull, against the ocean's own ` +
        `mean plane at y = ${hull.seaY}`,
    );
    agree(
      found.some((r) => r.width !== null),
      `${hull.classId}: no station found both corridor edges: ${JSON.stringify(hull.stations)}`,
    );
    if (hull.shipName === null)
      console.log(
        `NOTE ${hull.classId}: no ship in the battle draws ${hull.model}, so the game gives this hull no collision ` +
          `volume and the weapon test cannot be run against it.`,
      );
    else
      for (const row of found)
        for (const e of row.edge) {
          agree(
            e.inside,
            `${hull.classId}: a weapon at the ${e.side} deck edge (x=${e.x}) at ${row.station} misses ${hull.shipName}'s ` +
              `collision volume ${JSON.stringify(hull.shipBox)} — the drawn deck reaches ${Math.abs(e.x).toFixed(2)} m ` +
              `from the centreline, the volume ${(hull.shipBox.hullBeam / 2).toFixed(2)} m plus a 3 m margin`,
          );
          agree(
            !e.outboardHits,
            `${hull.classId}: a weapon one ${hull.hullBeam} m beam outboard of the ${e.side} edge at ${row.station} ` +
              `still hits ${hull.shipName}'s collision volume ${JSON.stringify(hull.shipBox)}`,
          );
        }
  }

  // One frame of each hull for a person to look at. AA is silenced first: the camera parks 600 m
  // off an enemy carrier's beam, and a gate that can be shot down is a gate that flakes.
  await page.evaluate(() => {
    for (const s of window.midway.battle.ships) s.aa = 0;
  });
  const RANGE = 480; // m abeam
  const ABOVE = 155; // m above the deck
  for (const hull of hulls) {
    await page.evaluate(
      async ({ shipId, origin, range, above }) => {
        const { bearing } = await window.__mod("/src/sim/math.ts");
        const { setAttitude } = await window.__mod("/src/sim/flight.ts");
        const battle = window.midway.battle;
        // Where the ship is NOW, not where it was during the survey: an enemy carrier steams at
        // 8 m/s, so a position read a few minutes ago aims the camera at open water.
        const live = shipId ? battle.ships.find((s) => s.id === shipId) : null;
        const at = live ? { x: live.x, z: live.z, heading: live.heading } : origin;
        const p = battle.player;
        // Abeam: `right` in a ship's frame is (cos heading, sin heading).
        // Spectator, because the flight model owns the aircraft's attitude: a heading written
        // straight onto the player is rewritten from the model's own quaternion on the very next
        // frame, and the camera reads that quaternion, not the heading. Spectator freezes the
        // player's step, and `setAttitude` — the engine's own writer — turns the aircraft with it.
        // The captures above are finished by now, so parking the player here costs nothing.
        Object.assign(p, {
          x: at.x + Math.cos(at.heading) * range,
          y: (live?.deckHeight ?? 0) + above,
          z: at.z + Math.sin(at.heading) * range,
          mode: "spectator",
          pitch: -Math.atan2(above, range),
          roll: 0,
        });
        p.heading = bearing(p, at);
        setAttitude(p, p.heading, p.pitch, 0);
        window.midway.world.snap = true;
      },
      { shipId: hull.shipId, origin: hull.origin, range: RANGE, above: ABOVE },
    );
    // Rendered frames, not simulated seconds: the ship is where it was placed, and the camera
    // snaps on the next world update.
    await page.evaluate(
      (count) =>
        new Promise((resolve) => {
          const tick = () => ((count -= 1) > 0 ? requestAnimationFrame(tick) : resolve());
          requestAnimationFrame(tick);
        }),
      4,
    );
    await page.screenshot({ path: `${OUT}/deck-${hull.classId}.png` });
  }
  await page.evaluate(() => {
    for (const staged of window.__staged) staged.parent?.remove(staged);
  });
  assert.deepEqual(
    disagreements,
    [],
    `the imported hulls agree with the game's own deck datum, keel and collision volume within ${TOL} m:\n  ` +
      disagreements.join("\n  "),
  );
  console.log(
    "hull survey " +
      hulls
        .map((h) => `${h.classId}: deck ${h.datumHeight}m, keel ${h.keelWorld}m, width ${h.stations.map((r) => r.width ?? "-").join("/")}`)
        .join(" | "),
  );

  assert.deepEqual(errors, []);
  console.log(
    `PASS: deck width measured from the carrier's own geometry at four stations, deck run and ` +
      `liftoff captured, low-altitude water captured, ${hulls.length} imported carrier hulls surveyed ` +
      `against their own deck datum, keel and collision volume within ${TOL} m, no console errors`,
  );
} finally {
  await browser.close();
}
