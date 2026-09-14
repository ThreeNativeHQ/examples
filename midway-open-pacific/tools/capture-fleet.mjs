/**
 * Browser capture for the imported fleet: the deck party, the Zero, the IJN destroyer and Midway.
 *
 * Every automated gate in this repo is blind to how the game looks, so this one exists to put the
 * new content in front of a camera and also to assert the facts a screenshot cannot show — that
 * the crew really are running different clips at different phases, and that an AI Zero really is
 * swapped to its imported airframe when the player closes on it.
 */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const URL = process.env.MIDWAY_URL || "http://127.0.0.1:5198";
const OUT = process.env.MIDWAY_SHOTS || "screenshots";

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
  // Import the module URL the page already loaded; a fresh import builds a second, unstarted game.
  await page.evaluate(async () => {
    const urls = performance
      .getEntriesByType("resource")
      .map((e) => e.name)
      .filter((n) => /\/src\/game\.ts(?:\?|$)/.test(n));
    if (!urls.length) throw new Error("Missing loaded game module");
    // Vite can leave more than one `game.ts?t=` entry behind, and only the one the page actually
    // started has a live scene; the newest is not always it. Take the one that does.
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
    adapter.vendor && !/swiftshader|lavapipe/i.test(JSON.stringify(adapter)),
    `software adapter: ${JSON.stringify(adapter)}`,
  );
  await mkdir(OUT, { recursive: true });
  // The scene re-aims the camera every frame even while paused, so a composed shot needs the
  // game's own camera step held off for the duration of the capture.
  const freezeCamera = () =>
    page.evaluate(() => {
      const s = window.midway;
      // Pause too: the battle keeps flying while the camera is held, so an aircraft read one
      // moment is somewhere else by the time the shutter opens.
      s.__wasPaused = s.paused;
      s.paused = true;
      const w = s.world;
      w.__updateCamera ??= w.updateCamera;
      w.updateCamera = () => {};
    });
  const releaseCamera = () =>
    page.evaluate(() => {
      const s = window.midway;
      const w = s.world;
      if (w.__updateCamera) w.updateCamera = w.__updateCamera;
      s.paused = s.__wasPaused ?? false;
    });
  const shot = async (name, place) => {
    await freezeCamera();
    await page.evaluate(place);
    await page.waitForTimeout(420);
    await page.screenshot({ path: `${OUT}/${name}.png` });
  };
  await page.screenshot({ path: `${OUT}/fleet-briefing.png` });

  // The deck party: twelve sailors, each with its own clip, phase and rate.
  const crew = await page.evaluate(() => {
    const group = window.midway.world.crew.group;
    return {
      visible: group.visible,
      count: group.children.length,
      position: group.position.toArray(),
      men: group.children.map((c) => ({
        x: +c.position.x.toFixed(2),
        z: +c.position.z.toFixed(2),
        yaw: +c.rotation.y.toFixed(2),
        height: +((c.scale.x || 1) * 1.83).toFixed(3),
        helmet: !!c.getObjectByName("Head")?.children.length,
      })),
    };
  });
  assert.equal(crew.count, 12, `deck party size: ${JSON.stringify(crew)}`);
  assert.ok(crew.visible, "the deck party is visible at the briefing");
  assert.ok(
    crew.men.every((m) => m.helmet),
    "every sailor wears his trade's helmet",
  );
  assert.ok(
    new Set(crew.men.map((m) => `${m.x},${m.z}`)).size === 12,
    "no two sailors stand in the same place",
  );
  assert.ok(
    new Set(crew.men.map((m) => m.yaw)).size >= 10,
    `sailors face different ways: ${JSON.stringify(crew.men.map((m) => m.yaw))}`,
  );
  assert.ok(
    crew.men.every((m) => m.height > 1.68 && m.height < 1.86),
    `every sailor stands at an adult height: ${JSON.stringify(crew.men.map((m) => m.height))}`,
  );
  assert.ok(new Set(crew.men.map((m) => m.height)).size >= 4, "heights vary across the party");
  console.log("deck party", JSON.stringify(crew.men));

  // Clip, phase and rate must all differ, or twelve men move as one.
  const motion = await page.evaluate(() => {
    const sailors = window.midway.world.crew.sailors ?? [];
    return sailors.map((s) => {
      const action = s.player.mixer.clipAction(s.player.clip(s.station.clip));
      return {
        job: s.station.job,
        clip: s.station.clip,
        rate: +s.rate.toFixed(3),
        time: +action.time.toFixed(3),
      };
    });
  });
  assert.equal(motion.length, 12, "every station reports its motion");
  assert.ok(new Set(motion.map((m) => m.clip)).size >= 5, "the party runs at least five clips");
  assert.ok(new Set(motion.map((m) => m.job)).size === 12, "no two sailors have the same job");
  assert.ok(new Set(motion.map((m) => m.rate)).size >= 5, "playback rates are detuned");
  const sameClip = motion.filter((m) => m.clip === motion[0].clip);
  assert.ok(
    new Set(sameClip.map((m) => m.time)).size === sameClip.length,
    `men on one clip start out of phase: ${JSON.stringify(sameClip)}`,
  );
  console.log("deck party motion", JSON.stringify(motion));

  // A close pass over the launch spot, so the sailors are actually in frame.
  await shot("fleet-crew", () => {
    const w = window.midway.world;
    const anchor = w.crew.group;
    anchor.updateMatrixWorld(true);
    const at = w.camera.position.clone();
    anchor.getWorldPosition(at);
    w.camera.position.set(at.x + 10, at.y + 3.4, at.z - 15);
    w.camera.lookAt(at.x - 1, at.y + 1.0, at.z + 2);
    w.camera.fov = 44;
    w.camera.up.set(0, 1, 0);
    w.camera.updateProjectionMatrix();
    w.camera.updateMatrixWorld();
  });
  await releaseCamera();

  // Close views of every crew motion. The wide deck shot hides broken hands and skin seams.
  if (process.env.MIDWAY_CREW_CLOSEUPS === "1") {
    const skinTriangles = await page.evaluate(() => {
      let triangles = 0;
      window.midway.world.crew.sailors[0].player.root.traverse((node) => {
        if (node.isSkinnedMesh) triangles += node.geometry.index.count / 3;
      });
      return triangles;
    });
    assert(skinTriangles >= 75000, `stale sailor mesh loaded: ${skinTriangles} triangles`);
    console.log("rebuilt sailor loaded", { skinTriangles });
    await freezeCamera();
    await page.evaluate(() => {
      for (const id of ["briefing", "hud"]) {
        const el = document.getElementById(id);
        if (el) el.style.visibility = "hidden";
      }
    });
    // The forward handler gives the idle clip an unobstructed view, away from the island wall.
    for (const index of [0, 1, 3, 5, 7, 9]) {
      for (const phase of [0.25, 0.75]) {
        const clip = await page.evaluate(({ index, phase }) => {
          const w = window.midway.world;
          const sailor = w.crew.sailors[index];
          const root = sailor.player.root;
          sailor.player.mixer.setTime(sailor.player.clip(sailor.station.clip).duration * phase);
          sailor.player.update(0);
          root.updateMatrixWorld(true);
          const at = root.getWorldPosition(w.camera.position.clone());
          const rotation = root.getWorldQuaternion(w.camera.quaternion.clone());
          const offset = at.clone().set(1.4, 1.2, 2.8).applyQuaternion(rotation);
          w.camera.position.copy(at).add(offset);
          w.camera.lookAt(at.x, at.y + 0.9, at.z);
          w.camera.up.set(0, 1, 0);
          w.camera.fov = 40;
          w.camera.updateProjectionMatrix();
          w.camera.updateMatrixWorld();
          return sailor.station.clip;
        }, { index, phase });
        await page.waitForTimeout(420);
        await page.screenshot({ path: `${OUT}/${clip}-${phase}.png` });
      }
    }
    await page.evaluate(() => {
      for (const id of ["briefing", "hud"]) {
        const el = document.getElementById(id);
        if (el) el.style.visibility = "";
      }
    });
    await releaseCamera();
  }

  // Inventory-driven deck park: both teams, correct airframe, bounded aft slots.
  const STATION = { wildcat: 72, sbd: 88, tbd: 104, zero: 72, val: 88, kate: 104 };
  const TEAM_TYPES = { us: ["wildcat", "sbd", "tbd"], jp: ["zero", "val", "kate"] };
  // Every parked type is a real model. The Wildcat stands in as the Douglas SBD and the Val as
  // the Kate — same-team substitutions, never the procedural silhouette.
  const MODEL_NAME = { wildcat: /SBD-3/, sbd: /SBD-3/, tbd: /Devastator/, zero: /A6M3/, val: /B5N2/, kate: /B5N2/ };
  const readPark = () =>
    page.evaluate(() => {
      const s = window.midway;
      return s.battle.ships
        .filter((x) => x.kind === "carrier")
        .map((ship) => {
          const mesh = s.world.meshes.get(ship.id);
          return {
            id: ship.id,
            name: ship.name,
            team: ship.team,
            ready: { ...ship.air.ready },
            parked: (mesh?.userData.parked ?? []).map((p) => {
              let geometry = null;
              p.traverse((o) => {
                if (geometry === null && o.isMesh && o.geometry) geometry = o.geometry.uuid;
              });
              return {
                type: p.userData.simAirframe,
                imported: !!p.userData.importedAircraft,
                name: p.name,
                visible: p.visible,
                geometry,
                pos: [+p.position.x.toFixed(3), +p.position.y.toFixed(3), +p.position.z.toFixed(3)],
              };
            }),
          };
        });
    });
  const park = await readPark();
  assert.equal(park.length, 7, `all seven carriers carry a deck park: ${park.length}`);
  for (const c of park) {
    assert.ok(c.parked.length > 0, `${c.name} parks its own airframes`);
    const types = c.parked.map((p) => p.type);
    assert.ok(
      types.every((t) => TEAM_TYPES[c.team].includes(t)),
      `${c.name} parks only its team's types: ${JSON.stringify(types)}`,
    );
    assert.deepEqual(
      [...types].sort(),
      TEAM_TYPES[c.team].slice().sort(),
      `${c.name} parks every airframe it has ready: ${JSON.stringify(c.ready)}`,
    );
    const zs = c.parked.map((p) => p.pos[2]);
    assert.equal(new Set(zs).size, zs.length, `${c.name} parks no two aircraft in one slot: ${JSON.stringify(zs)}`);
    for (const p of c.parked) {
      assert.equal(p.pos[0], -1, `${c.name}/${p.type} parks on the measured aft line`);
      assert.equal(p.pos[2], STATION[p.type], `${c.name}/${p.type} parks in its own station`);
      assert.equal(p.imported, true, `${c.name}/${p.type} uses a real model, never the procedural silhouette`);
      assert.ok(MODEL_NAME[p.type].test(p.name), `${c.name}/${p.type} is the right model: ${p.name}`);
    }
  }
  console.log("deck park", JSON.stringify(park.map((c) => ({ name: c.name, team: c.team, parked: c.parked.map((p) => p.type) }))));

  const deckView = async (name, find) => {
    await shot(name, `(${find})(window.midway)`);
    await releaseCamera();
  };
  // Both teams, from abeam-above the aft park, so the parked airframes are the subject.
  await deckView("fleet-deck-us", `(s) => {
    const ship = s.battle.ships.find((x) => x.id === s.battle.home.id);
    const mesh = s.world.meshes.get(ship.id);
    mesh.updateMatrixWorld(true);
    const at = mesh.localToWorld(new (s.world.camera.position.constructor)(-1, ship.deckHeight, 88));
    s.world.camera.position.set(at.x + 30, at.y + 20, at.z + 34);
    s.world.camera.lookAt(at.x, at.y, at.z);
    s.world.camera.fov = 44;
    s.world.camera.up.set(0, 1, 0);
    s.world.camera.updateProjectionMatrix();
    s.world.camera.updateMatrixWorld();
  }`);
  await deckView("fleet-deck-ijn", `(s) => {
    const ship = s.battle.ships.find((x) => x.kind === "carrier" && x.team === "jp");
    const mesh = s.world.meshes.get(ship.id);
    mesh.updateMatrixWorld(true);
    const at = mesh.localToWorld(new (s.world.camera.position.constructor)(-1, ship.deckHeight, 88));
    s.world.camera.position.set(at.x + 30, at.y + 20, at.z + 34);
    s.world.camera.lookAt(at.x, at.y, at.z);
    s.world.camera.fov = 44;
    s.world.camera.up.set(0, 1, 0);
    s.world.camera.updateProjectionMatrix();
    s.world.camera.updateMatrixWorld();
  }`);

  // Ready-line depletion is a fixture: it writes the sim's own ready record and calls the same
  // `refreshDeck` the launch gate uses, because no public method removes one chosen airframe type
  // (`wreckAircraft` always takes the fullest line). This is not a natural carrier-cycle proof.
  const depletion = await page.evaluate(() => {
    const s = window.midway;
    const ship = s.battle.ships.find((x) => x.id === s.battle.home.id);
    const type = "sbd";
    const before = ship.air.ready[type];
    ship.air.ready[type] = 0;
    ship.air.damaged[type] = (ship.air.damaged[type] ?? 0) + before;
    s.battle.refreshDeck(ship);
    return { type, before, after: ship.air.ready[type] };
  });
  assert.equal(depletion.after, 0, `the fixture empties the ready line: ${JSON.stringify(depletion)}`);
  await page.waitForTimeout(250);
  const wrecked = await page.evaluate(() => {
    const s = window.midway;
    const mesh = s.world.meshes.get(s.battle.home.id);
    return (mesh.userData.parked ?? []).map((p) => ({ type: p.userData.simAirframe, visible: p.visible }));
  });
  assert.deepEqual(
    wrecked.filter((p) => !p.visible).map((p) => p.type),
    [depletion.type],
    `only the wrecked airframe leaves the park: ${JSON.stringify(wrecked)}`,
  );
  assert.ok(wrecked.filter((p) => p.visible).length >= 2, `the other types stay spotted: ${JSON.stringify(wrecked)}`);
  console.log("deck park depletion", JSON.stringify({ wrecked: depletion.type, after: wrecked }));

  // Restock is a fixture that writes the sim's own ready line back, not a natural service cycle.
  await page.evaluate((type) => {
    const s = window.midway;
    const ship = s.battle.ships.find((x) => x.id === s.battle.home.id);
    ship.air.ready[type] = ship.air.airframes[type];
    ship.air.damaged[type] = 0;
    s.battle.refreshDeck(ship);
  }, depletion.type);
  await page.waitForTimeout(250);
  const restored = await page.evaluate((type) => {
    const s = window.midway;
    const mesh = s.world.meshes.get(s.battle.home.id);
    const p = (mesh.userData.parked ?? []).find((x) => x.userData.simAirframe === type);
    return { type, visible: p?.visible };
  }, depletion.type);
  assert.ok(restored.visible, `a restocked airframe returns to the park: ${JSON.stringify(restored)}`);

  // The real NEW OPERATION restart builds a fresh Battle and must not dispose shared geometry.
  const homeId = await page.evaluate(() => window.midway.battle.home.id);
  const beforeRestart = park.flatMap((c) => c.parked.filter((p) => p.imported).map((p) => p.geometry));
  await page.evaluate(() => document.getElementById("restart-pause").click());
  await page.waitForTimeout(700);
  const afterRestart = await readPark();
  const afterGeom = afterRestart.flatMap((c) => c.parked.filter((p) => p.imported).map((p) => p.geometry));
  assert.equal(afterGeom.length, beforeRestart.length, "restart keeps the same park instances");
  assert.deepEqual(afterGeom, beforeRestart, "restart does not destroy or rebuild shared airframe geometry");
  assert.deepEqual(
    afterRestart.map((c) => c.parked.length),
    park.map((c) => c.parked.length),
    "restart keeps every carrier's park",
  );
  const homePark = afterRestart.find((c) => c.id === homeId);
  assert.ok(homePark && homePark.parked.every((p) => p.visible), "restart restores the home deck park");
  console.log("deck park restart", JSON.stringify({ carriers: afterRestart.length, shared: afterGeom.length }));

  // Fly, then measure the imported-airframe swap on live AI aircraft.
  await page.click("#start-air");
  const seconds = async (n) => {
    const t = await page.evaluate(() => window.midway.battle.time);
    await page.waitForFunction((u) => window.midway.battle.time >= u, t + n, {
      timeout: Math.max(20000, n * 4000),
    });
  };
  await seconds(3);
  await page.screenshot({ path: `${OUT}/fleet-flight.png` });

  // Put the player on top of an enemy fighter so the detail loan is granted, and read it back.
  const swap = await page.evaluate(async () => {
    const s = window.midway;
    const target = s.battle.aircraft.find((a) => a.team === "jp" && a.kind === "fighter");
    if (!target) return { skipped: "no Japanese fighter airborne" };
    Object.assign(s.battle.player, { x: target.x + 60, y: target.y, z: target.z + 60 });
    s.__zeroId = target.id;
    return { id: target.id, team: target.team, kind: target.kind, airframe: target.airframe };
  });
  if (!swap.skipped) {
    await seconds(1.2);
    const detail = await page.evaluate(
      (id) => {
        const m = window.midway.world.meshes.get(id);
        return m ? { name: m.name, detailed: !!m.userData.detailed, airframe: m.userData.airframe } : null;
      },
      swap.id,
    );
    assert.ok(detail, `the Zero ${swap.id} still has a mesh`);
    assert.ok(detail.detailed, `a Japanese fighter alongside gets its imported airframe: ${JSON.stringify(detail)}`);
    assert.equal(detail.airframe, "zero", JSON.stringify(detail));
    console.log("imported AI airframe", JSON.stringify({ swap, detail }));
    await shot("fleet-zero", () => {
      const s2 = window.midway;
      const m = s2.world.meshes.get(s2.__zeroId);
      const at = m.position;
      s2.world.camera.position.set(at.x + 17, at.y + 6, at.z + 22);
      s2.world.camera.lookAt(at.x, at.y, at.z);
      s2.world.camera.fov = 42;
      s2.world.camera.up.set(0, 1, 0);
      s2.world.camera.updateProjectionMatrix();
      s2.world.camera.updateMatrixWorld();
    });
    await releaseCamera();
  } else {
    console.log("imported AI airframe", JSON.stringify(swap));
  }

  // Japanese dive bombers must no longer be flying as Douglas SBDs.
  const identity = await page.evaluate(() => {
    const counts = {};
    for (const a of window.midway.battle.aircraft)
      counts[`${a.team}/${a.kind}/${a.airframe}`] = (counts[`${a.team}/${a.kind}/${a.airframe}`] ?? 0) + 1;
    return counts;
  });
  assert.ok(
    !Object.keys(identity).some((k) => k.startsWith("jp/bomber/sbd")),
    `no Japanese aircraft carries an American airframe: ${JSON.stringify(identity)}`,
  );
  console.log("airframe identity", JSON.stringify(identity));

  // Midway itself, from altitude.
  await shot("fleet-midway", () => {
    const s = window.midway;
    const i = s.battle.island;
    s.world.camera.position.set(i.x - 3400, 2400, i.z + 5200);
    s.world.camera.lookAt(i.x, 0, i.z);
    s.world.camera.fov = 60;
    s.world.camera.up.set(0, 1, 0);
    s.world.camera.updateProjectionMatrix();
    s.world.camera.updateMatrixWorld();
  });

  // An IJN destroyer at close range, with its imported hull selected by the LOD.
  const ship = await page.evaluate(() => {
    const s = window.midway;
    const d = s.battle.ships.find((x) => x.kind === "destroyer" && x.team === "jp");
    if (!d) return null;
    s.__shipId = d.id;
    const mesh = s.world.meshes.get(d.id);
    const lod = mesh?.children[0];
    return {
      name: d.name,
      imported: !!mesh?.userData.importedShip,
      levels: lod?.levels?.length ?? 0,
      heading: +d.heading.toFixed(3),
    };
  });
  assert.ok(ship?.imported, `Japanese destroyers use the imported hull: ${JSON.stringify(ship)}`);
  assert.equal(ship.levels, 2, `near and far levels: ${JSON.stringify(ship)}`);
  // Broadside, from the ship's own port beam, so bow orientation is unmistakable in the frame.
  await shot("fleet-destroyer", () => {
    const s = window.midway;
    const d = s.battle.ships.find((x) => x.id === s.__shipId);
    const beam = d.heading + Math.PI / 2;
    s.world.camera.position.set(d.x + Math.sin(beam) * 175, 34, d.z - Math.cos(beam) * 175);
    s.world.camera.lookAt(d.x, 10, d.z);
    s.world.camera.fov = 46;
    s.world.camera.up.set(0, 1, 0);
    s.world.camera.updateProjectionMatrix();
    s.world.camera.updateMatrixWorld();
  });
  console.log("destroyer", JSON.stringify(ship));

  assert.deepEqual(errors, []);
  console.log(
    "PASS: twelve distinct deck-crew stations with helmets, out-of-phase clips and detuned rates; " +
      "inventory-driven deck park on all seven carriers (correct per-team airframes, bounded aft " +
      "slots, one type leaving/returning at a time, restart keeps shared geometry); " +
      "imported Zero on nearby AI; Japanese bombers off the SBD airframe; imported IJN destroyer " +
      "with two LOD levels; Midway atoll captured; no console or GPU errors",
  );
} finally {
  await browser.close();
}
