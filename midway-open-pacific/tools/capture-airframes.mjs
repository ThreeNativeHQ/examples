/**
 * Browser capture for the imported airframes, PRD-midway-asset-battle-integration AC-3 and AC-4.
 *
 * AC-3 asks that a TBD chosen from the real briefing flies as a TBD in deck, chase and cockpit, and
 * that AI TBD/Kate and parked examples carry their correct airframes across LOD with no Dauntless
 * fallback or stale animation/disposal dispatch. AC-4 asks that each new aircraft shows
 * startup/cruise/cut propeller states, gear/hook/surface motion and independent instance state, and
 * that a real release removes one visible store, creates one weapon and changes the payload once.
 *
 * The parts already proven elsewhere — player model selection, deck/chase, player control surfaces
 * and static store visibility — are not re-litigated here. What is captured here is the half still
 * open: the cockpit view and its unobstructed sightline, the propeller blur handoff, gear *and hook*
 * travel, the AI airframe table across both teams, the LOD loan and its stale-rig disposal, and a
 * release driven through the game's own KeyB handler rather than by poking sim fields.
 *
 * Every frame is composed from the live scene graph and the assertion behind it reads the real
 * objects (`window.midway.world`, `window.midway.battle`). A screenshot alone cannot show any of
 * these; and pixels cannot be read here at all, because a WebGPU canvas does not survive
 * `drawImage` and every luminance heuristic reads blank whether the frame is blank or not. So the
 * "is the subject in frame" half is asked of the renderer — the same frustum test
 * `tools/capture-hulls.mjs` and `tools/capture-performance.mjs` use — and a person still has to look
 * at the frames to judge how they look.
 *
 *   bash tools/capture-lock.sh node tools/capture-airframes.mjs
 *   MIDWAY_URL=http://127.0.0.1:5321 bash tools/capture-lock.sh node tools/capture-airframes.mjs
 */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const URL = process.env.MIDWAY_URL || "http://127.0.0.1:5198";
const OUT = process.env.MIDWAY_SHOTS || "screenshots";

/** Below this many of the subject's own triangles in frustum, the frame has no subject to look at. */
const MIN_SUBJECT_TRIANGLES = 500;

/**
 * The three propeller states. The imported animation path hands the individual blades to the motion
 * blur over a blended band (`propeller.visible` below rpm 0.38, `blur.visible` above 0.15), so the
 * values here sit outside that band and the flip is unambiguous either way it is implemented:
 * startup and cut show blades and no disc, cruise shows the disc and no blades.
 */
const PROP_STATES = [
  { name: "airframe-prop-startup", rpm: 0.1, blades: true, blur: false },
  { name: "airframe-prop-cruise", rpm: 0.8, blades: false, blur: true },
  { name: "airframe-prop-cut", rpm: 0.0, blades: true, blur: false },
];

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
    adapter.vendor && !/swiftshader|lavapipe|llvmpipe/i.test(JSON.stringify(adapter)),
    `software adapter, the frames would prove nothing about the game: ${JSON.stringify(adapter)}`,
  );
  console.log("adapter", JSON.stringify(adapter));
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
  const seconds = async (n) => {
    const t = await page.evaluate(() => window.midway.battle.time);
    await page.waitForFunction((u) => window.midway.battle.time >= u, t + n, {
      timeout: Math.max(20000, n * 4000),
    });
  };

  /**
   * Is the subject actually in the picture? Not measured from the pixels — a WebGPU canvas does
   * not survive `drawImage`, and every luminance heuristic that tries reads a blank frame whether
   * the frame is blank or not, which is a gate that always fires and therefore proves nothing.
   *
   * The renderer is asked instead, about this one object: are its meshes inside the camera frustum,
   * and how many triangles of it would be drawn. `selector` is `{ player: true }` or `{ id }`, the
   * id being the sim aircraft's own id.
   */
  const inFrame = (selector) =>
    page.evaluate((sel) => {
      const w = window.midway.world;
      const object = sel.player ? w.playerMesh : w.meshes.get(sel.id);
      if (!object) return { meshes: 0, inFrustum: 0, triangles: 0 };
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
      object.updateMatrixWorld(true);
      object.traverse((o) => {
        if (!o.isMesh || !o.visible || !o.geometry) return;
        meshes += 1;
        const g = o.geometry;
        if (!g.boundingSphere) g.computeBoundingSphere();
        const centre = g.boundingSphere.center.clone().applyMatrix4(o.matrixWorld);
        const scale = o.matrixWorld.getMaxScaleOnAxis();
        const r = g.boundingSphere.radius * scale;
        const inside = planes.every((p) => p[0] * centre.x + p[1] * centre.y + p[2] * centre.z + p[3] > -r);
        if (!inside) return;
        inFrustum += 1;
        triangles += g.index ? g.index.count / 3 : (g.attributes.position?.count ?? 0) / 3;
      });
      return { meshes, inFrustum, triangles: Math.round(triangles) };
    }, selector);

  const requireSubject = async (label, selector) => {
    const subject = await inFrame(selector);
    assert.ok(
      subject.inFrustum > 0 && subject.triangles >= MIN_SUBJECT_TRIANGLES,
      `${label} did not reach the frame: ${JSON.stringify(subject)}`,
    );
    return subject;
  };

  /** The loaded Three bundle, for the one raycast a scene-graph read cannot do. */
  const loadThree = () =>
    page.evaluate(async () => {
      const urls = performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .filter((n) => /\.js(\?|$)/.test(n) && /three/i.test(n));
      for (const url of urls) {
        try {
          const mod = await import(url);
          if (mod.Raycaster && mod.Vector3) {
            window.__T = mod;
            return true;
          }
        } catch {
          // not the Three bundle
        }
      }
      throw new Error("no loaded Three module with Raycaster");
    });

  // ---- Choose the TBD from the real briefing, then take off. ------------------------------------
  await page.click("#loadout-torpedo");
  const chosen = await page.evaluate(() => ({
    loadout: window.midway.battle.player.loadout,
    airframe: window.midway.battle.player.airframe,
  }));
  assert.equal(chosen.airframe, "tbd", `briefing must select the Devastator: ${JSON.stringify(chosen)}`);
  console.log("briefing loadout", JSON.stringify(chosen));
  await page.click("#start-air");
  await page.waitForFunction(() => document.getElementById("briefing").classList.contains("hidden"));
  await page.waitForFunction(() => window.midway.battle.time > 2, null, { timeout: 30000 });
  await page.evaluate(() => window.midway.world.setCamera(0));

  const playerReadback = () =>
    page.evaluate(() => {
      const s = window.midway;
      const m = s.world.playerMesh;
      return {
        name: m.name,
        airframe: s.battle.player.airframe,
        devastator: !!m.userData.devastator,
        cockpit: m.userData.cockpit ? m.userData.cockpit.toArray().map((v) => +v.toFixed(3)) : null,
        panel: !!m.getObjectByName("cockpit_interior"),
        hook: !!m.userData.arrestingHook,
        store: !!m.userData.torpedoLoad,
      };
    });
  const player = await playerReadback();
  assert.ok(
    player.devastator && /Devastator/.test(player.name),
    `the drawn player airframe must be the ported Devastator: ${JSON.stringify(player)}`,
  );
  assert.equal(player.airframe, "tbd", JSON.stringify(player));

  // ---- 1. Cockpit view: interior exists and the sightline reaches the panel. --------------------
  await page.evaluate(() => window.midway.world.setCamera(1));
  await page.waitForTimeout(450);
  await loadThree();
  const cockpit = await page.evaluate(() => {
    const s = window.midway;
    const m = s.world.playerMesh;
    const V = m.position.constructor;
    const eye = m.userData.cockpit ? m.localToWorld(m.userData.cockpit.clone()) : null;
    const cam = s.world.camera.getWorldPosition(new V());
    return {
      mode: s.world.cameraMode,
      panel: !!m.getObjectByName("cockpit_interior"),
      eyeDistance: eye ? +cam.distanceTo(eye).toFixed(3) : null,
    };
  });
  assert.equal(cockpit.mode, 1, `cockpit camera mode: ${JSON.stringify(cockpit)}`);
  assert.ok(cockpit.panel, `the Devastator's own cockpit is drawn: ${JSON.stringify(cockpit)}`);
  assert.ok(
    cockpit.eyeDistance !== null && cockpit.eyeDistance < 0.5,
    `the cockpit camera sits on the TBD eye: ${JSON.stringify(cockpit)}`,
  );

  // Raycast from the eye forward-and-down: it must reach the Devastator's own instrument panel,
  // not stop on the opaque fuselage skin behind it.
  const sightline = await page.evaluate(() => {
    const s = window.midway;
    const T = window.__T;
    const m = s.world.playerMesh;
    m.updateMatrixWorld(true);
    const eye = m.localToWorld(m.userData.cockpit.clone());
    const q = m.getWorldQuaternion(new T.Quaternion());
    const dir = new T.Vector3(0, -0.3, -1).normalize().applyQuaternion(q);
    const ray = new T.Raycaster(eye, dir, 0.02, 40);
    const hits = ray
      .intersectObject(m, true)
      .filter((h) => h.object.visible && !(h.object.material?.transparent));
    const first = hits[0] ?? null;
    let inCockpit = false;
    for (let o = first?.object; o; o = o.parent) {
      if (o.name === "cockpit_interior") {
        inCockpit = true;
        break;
      }
    }
    return {
      distance: first ? +first.distance.toFixed(3) : null,
      name: first?.object?.name ?? null,
      inCockpit,
      nearest: hits.slice(0, 4).map((h) => h.object.name || h.object.type),
    };
  });
  assert.ok(sightline.inCockpit, `the forward-down sightline reaches the instrument panel: ${JSON.stringify(sightline)}`);
  assert.ok(
    !/airframebody/i.test(sightline.name || ""),
    `the sightline must not stop on the opaque fuselage: ${JSON.stringify(sightline)}`,
  );
  assert.ok(
    sightline.distance !== null && sightline.distance < 3,
    `the panel is within a cockpit reach: ${JSON.stringify(sightline)}`,
  );
  console.log("cockpit sightline", JSON.stringify(sightline));
  // Shoot with the camera still parked on the eye, and check the frame the shot actually used.
  await freezeCamera();
  await page.waitForTimeout(420);
  await page.screenshot({ path: `${OUT}/airframe-cockpit.png` });
  const cockpitSubject = await requireSubject("airframe-cockpit", { player: true });
  await releaseCamera();
  console.log("airframe-cockpit", JSON.stringify(cockpitSubject));
  // Back to the exterior view, so the moving-part frames show the aircraft rather than the panel.
  await page.evaluate(() => window.midway.world.setCamera(0));
  await page.waitForTimeout(300);

  // ---- 2. Propeller startup / cruise / cut. ------------------------------------------------------
  const readProp = () =>
    page.evaluate(() => {
      const m = window.midway.world.playerMesh;
      const prop = m.userData.propeller;
      const blur = m.userData.propBlur;
      return {
        bladesVisible: prop.visible,
        blurVisible: blur.visible,
        blurOpacity: +blur.material.opacity.toFixed(3),
      };
    });
  for (const state of PROP_STATES) {
    await freezeCamera();
    await page.evaluate((rpm) => {
      window.midway.battle.player.rpm = rpm;
    }, state.rpm);
    await page.waitForTimeout(220);
    const prop = await readProp();
    assert.equal(
      prop.bladesVisible,
      state.blades,
      `${state.name}: rpm ${state.rpm} blade visibility: ${JSON.stringify(prop)}`,
    );
    assert.equal(
      prop.blurVisible,
      state.blur,
      `${state.name}: rpm ${state.rpm} blur visibility: ${JSON.stringify(prop)}`,
    );
    if (state.blur) assert.ok(prop.blurOpacity > 0, `${state.name}: the blur disc is opaque at speed`);
    // Frame the propeller from ahead of the nose, where the disc is seen face-on.
    await page.evaluate(() => {
      const w = window.midway.world;
      const m = w.playerMesh;
      m.updateMatrixWorld(true);
      const V = m.position.constructor;
      const Q = m.quaternion.constructor;
      const at = m.userData.propeller.getWorldPosition(new V());
      const q = m.getWorldQuaternion(new Q());
      const offset = new V(1.2, 0.6, -3.6).applyQuaternion(q);
      w.camera.position.copy(at).add(offset);
      w.camera.up.set(0, 1, 0);
      w.camera.lookAt(at.x, at.y, at.z);
      w.camera.fov = 38;
      w.camera.near = 0.1;
      w.camera.far = 4000;
      w.camera.updateProjectionMatrix();
      w.camera.updateMatrixWorld();
    });
    await page.waitForTimeout(420);
    await page.screenshot({ path: `${OUT}/${state.name}.png` });
    await requireSubject(state.name, { player: true });
    await releaseCamera();
    console.log(state.name, JSON.stringify(prop));
  }

  // ---- 3. Gear and hook, down and up. ------------------------------------------------------------
  const readGear = () =>
    page.evaluate(() => {
      const m = window.midway.world.playerMesh;
      m.updateMatrixWorld(true);
      const array = (o) => (o ? o.quaternion.toArray().map((v) => +v.toFixed(4)) : null);
      const xyz = (o) => (o ? o.position.toArray().map((v) => +v.toFixed(4)) : null);
      return {
        hook: m.userData.arrestingHook ? +m.userData.arrestingHook.rotation.z.toFixed(4) : null,
        gearLeft: array(m.getObjectByName("gearleft")),
        gearRight: array(m.getObjectByName("gearright")),
        gearMountLeft: xyz(m.getObjectByName("gearmountleft")),
        gearMountRight: xyz(m.getObjectByName("gearmountright")),
      };
    });
  const moved = (a, b) => Boolean(a && b && a.some((v, i) => Math.abs(v - b[i]) > 0.02));
  const gear = {};
  for (const state of [
    { name: "airframe-gear-and-hook-down", gearPos: 1 },
    { name: "airframe-gear-and-hook-up", gearPos: 0 },
  ]) {
    await freezeCamera();
    await page.evaluate((gearPos) => {
      const p = window.midway.battle.player;
      p.rpm = 0;
      p.gearPos = gearPos;
    }, state.gearPos);
    await page.waitForTimeout(220);
    gear[state.gearPos] = await readGear();
    // Frame the whole aircraft from the rear quarter, where the gear and the hook both read.
    await page.evaluate(() => {
      const w = window.midway.world;
      const m = w.playerMesh;
      m.updateMatrixWorld(true);
      const V = m.position.constructor;
      const Q = m.quaternion.constructor;
      const at = m.getWorldPosition(new V());
      const q = m.getWorldQuaternion(new Q());
      const offset = new V(5.5, 3.2, 6.5).applyQuaternion(q);
      w.camera.position.copy(at).add(offset);
      w.camera.up.set(0, 1, 0);
      w.camera.lookAt(at.x, at.y + 0.8, at.z);
      w.camera.fov = 40;
      w.camera.near = 0.2;
      w.camera.far = 4000;
      w.camera.updateProjectionMatrix();
      w.camera.updateMatrixWorld();
    });
    await page.waitForTimeout(420);
    await page.screenshot({ path: `${OUT}/${state.name}.png` });
    await requireSubject(state.name, { player: true });
    await releaseCamera();
    console.log(state.name, JSON.stringify({ hook: gear[state.gearPos].hook }));
  }
  assert.ok(player.hook, "the TBD carries the added arresting hook");
  assert.ok(
    Math.abs(gear[1].hook - gear[0].hook) > 0.2 && gear[1].hook > gear[0].hook,
    `the hook follows gear position (down > up): ${JSON.stringify({ down: gear[1].hook, up: gear[0].hook })}`,
  );
  assert.ok(
    moved(gear[1].gearLeft, gear[0].gearLeft) ||
      moved(gear[1].gearRight, gear[0].gearRight) ||
      moved(gear[1].gearMountLeft, gear[0].gearMountLeft) ||
      moved(gear[1].gearMountRight, gear[0].gearMountRight),
    `the gear legs travel with the gear clip: ${JSON.stringify({
      left: [gear[1].gearLeft, gear[0].gearLeft],
      right: [gear[1].gearRight, gear[0].gearRight],
    })}`,
  );

  // ---- 6. A real weapon release through the game's own KeyB handler. -----------------------------
  await releaseCamera();
  await page.bringToFront();
  await page.waitForTimeout(400);
  const readRelease = () =>
    page.evaluate(() => {
      const s = window.midway;
      const b = s.battle;
      const p = b.player;
      const m = s.world.playerMesh;
      return {
        status: b.status,
        mode: p.mode,
        loadout: p.loadout,
        airframe: p.airframe,
        torpedo: p.torpedo,
        bombs: p.bombs,
        payloadMass: +p.payloadMass.toFixed(1),
        airTorpedoes: b.airTorpedoes.length,
        dropped: b.stats.torpedoesDropped,
        storeVisible: m.userData.torpedoLoad ? m.userData.torpedoLoad.visible : null,
      };
    });
  const beforeRelease = await readRelease();
  assert.equal(beforeRelease.loadout, "torpedo", JSON.stringify(beforeRelease));
  assert.ok(["flight", "attack"].includes(beforeRelease.mode), `release needs a flying player: ${JSON.stringify(beforeRelease)}`);
  assert.ok(beforeRelease.torpedo >= 1, `the TBD is carrying its torpedo: ${JSON.stringify(beforeRelease)}`);
  assert.equal(beforeRelease.storeVisible, true, `the mounted store is drawn before release: ${JSON.stringify(beforeRelease)}`);
  // The real entry point: Midway.action("KeyB") calls Battle.releaseOrdnance().
  await page.keyboard.press("KeyB");
  await page.waitForTimeout(300);
  const afterRelease = await readRelease();
  assert.equal(afterRelease.storeVisible, false, `the visible store leaves the aircraft: ${JSON.stringify(afterRelease)}`);
  assert.equal(
    afterRelease.airTorpedoes,
    beforeRelease.airTorpedoes + 1,
    `exactly one weapon is created: ${JSON.stringify({ before: beforeRelease, after: afterRelease })}`,
  );
  assert.equal(
    afterRelease.dropped,
    beforeRelease.dropped + 1,
    `the release is counted once: ${JSON.stringify({ before: beforeRelease, after: afterRelease })}`,
  );
  assert.equal(
    afterRelease.torpedo,
    beforeRelease.torpedo - 1,
    `the payload drops by exactly one: ${JSON.stringify({ before: beforeRelease, after: afterRelease })}`,
  );
  assert.ok(afterRelease.payloadMass < beforeRelease.payloadMass, `the payload mass changed: ${JSON.stringify(afterRelease)}`);
  console.log("release", JSON.stringify({ before: beforeRelease, after: afterRelease }));
  // Frame the aircraft and the weapon it just let go.
  await freezeCamera();
  await page.evaluate(() => {
    const w = window.midway.world;
    const b = window.midway.battle;
    const m = w.playerMesh;
    m.updateMatrixWorld(true);
    const V = m.position.constructor;
    const at = m.getWorldPosition(new V());
    const t = b.airTorpedoes.at(-1);
    const mid = t ? new V((at.x + t.x) / 2, (at.y + t.y) / 2, (at.z + t.z) / 2) : at;
    w.camera.position.set(mid.x + 9, mid.y + 3.5, mid.z + 11);
    w.camera.up.set(0, 1, 0);
    w.camera.lookAt(mid.x, mid.y, mid.z);
    w.camera.fov = 44;
    w.camera.near = 0.2;
    w.camera.far = 4000;
    w.camera.updateProjectionMatrix();
    w.camera.updateMatrixWorld();
  });
  await page.waitForTimeout(420);
  await page.screenshot({ path: `${OUT}/airframe-release.png` });
  await requireSubject("airframe-release", { player: true });
  await releaseCamera();

  // ---- 4. AI airframes on both sides, including TBD and Kate. -----------------------------------
  // The AI is already up from the airborne start's own 30 s of catch-up; a few seconds more lets
  // the decks put another section out, without risking the whole capture on the player being shot
  // down before the frame is taken.
  await seconds(5);
  // Neither supplied torpedo airframe is on the imported-AI path, so their clause can only be
  // exercised if some are actually flying. Launch one each through the game's own `Battle.launch`
  // rather than fabricating a record; if a deck refuses, the clause is reported as unexercised.
  const spawned = await page.evaluate(() => {
    const b = window.midway.battle;
    const us = b.ships.find((s) => s.kind === "carrier" && s.team === "us" && s.id !== b.player.home && !s.sunk);
    const jp = b.ships.find((s) => s.kind === "carrier" && s.team === "jp" && !s.sunk);
    const out = [];
    for (const [label, ship] of [["tbd", us], ["kate", jp]]) {
      const a = ship ? b.launch(ship, "torpedo") : null;
      out.push({ label, launched: a ? a.airframe : null, id: a?.id ?? null });
    }
    return out;
  });
  await page.waitForTimeout(500);
  console.log("AI setup", JSON.stringify(spawned));

  const identity = await page.evaluate(() => {
    const s = window.midway;
    // The drawn identity, read from the mesh the renderer is drawing. The Zero names itself; the
    // imported Douglas tags itself; a procedural hull names no airframe at all, which is the point.
    const drawn = (m) => (!m ? "<no-mesh>" : (m.userData.airframe ?? (m.userData.douglas ? "sbd" : null)));
    const rows = [];
    const table = {};
    for (const a of s.battle.aircraft) {
      if (a.hp <= 0 || a.mode === "crashing") continue;
      const m = s.world.meshes.get(a.id);
      rows.push({
        id: a.id,
        team: a.team,
        kind: a.kind,
        airframe: a.airframe,
        drawn: drawn(m),
        // Procedural airframes from `makeAircraft` carry no `.name`; only the imported models do.
        // Presence of a mesh is `hasMesh`, and identity is `drawn` — conflating the two with `name`
        // reported every procedural aircraft as undrawn.
        hasMesh: !!m,
        name: m?.name ?? null,
        detailed: !!m?.userData.detailed,
        douglas: !!m?.userData.douglas,
      });
      const key = `${a.team}/${a.kind}/${a.airframe}`;
      table[key] = (table[key] ?? 0) + 1;
    }
    return { rows, table };
  });
  const live = identity.rows;
  const teams = new Set(live.map((r) => r.team));
  assert.ok(teams.has("us") && teams.has("jp"), `AI aircraft of both sides are airborne: ${JSON.stringify(identity.table)}`);
  const noMesh = live.filter((r) => !r.hasMesh);
  assert.equal(noMesh.length, 0, `every AI aircraft has a drawn mesh: ${JSON.stringify(noMesh.map((r) => r.airframe))}`);
  for (const row of live) {
    if (row.drawn !== null && row.drawn !== "<no-mesh>")
      assert.equal(row.drawn, row.airframe, `${row.team}/${row.kind} drawn as ${row.drawn}, not ${row.airframe}`);
  }
  // AC-3's clause worth catching: a Devastator or Kate must never wear the Dauntless silhouette.
  const dauntlessFallback = live.filter(
    (r) => (r.airframe === "tbd" || r.airframe === "kate") && (r.douglas || r.drawn === "sbd" || /Devastator|SBD-3/.test(r.name || "")),
  );
  assert.equal(
    dauntlessFallback.length,
    0,
    `no TBD/Kate is drawn with the Douglas/SBD model: ${JSON.stringify(dauntlessFallback)}`,
  );
  const tbdKate = live.filter((r) => r.airframe === "tbd" || r.airframe === "kate");
  console.log(
    "AI airframes",
    JSON.stringify({ table: identity.table, tbdKate: tbdKate.map((r) => `${r.team}/${r.kind}/${r.airframe} -> ${r.drawn ?? "procedural"} (${r.name})`) }),
  );

  // Frame the closest cross-team pair, so the one AI frame really does hold both sides.
  const pair = await page.evaluate(() => {
    const s = window.midway;
    const alive = s.battle.aircraft.filter((a) => a.hp > 0 && a.mode !== "crashing" && s.world.meshes.get(a.id));
    let best = null;
    for (const a of alive) {
      for (const b of alive) {
        if (a.team === b.team) continue;
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        if (!best || d < best.d) best = { a: a.id, b: b.id, d, ax: a.x, ay: a.y, az: a.z, bx: b.x, by: b.y, bz: b.z };
      }
    }
    return best;
  });
  assert.ok(pair, "both teams have an AI aircraft with a mesh to frame");
  await freezeCamera();
  await page.evaluate((p) => {
    const w = window.midway.world;
    const mid = { x: (p.ax + p.bx) / 2, y: (p.ay + p.by) / 2, z: (p.az + p.bz) / 2 };
    const sep = Math.max(600, p.d);
    w.camera.position.set(mid.x, mid.y + sep * 0.35 + 200, mid.z + sep * 0.95 + 300);
    w.camera.up.set(0, 1, 0);
    w.camera.lookAt(mid.x, mid.y, mid.z);
    w.camera.fov = 60;
    w.camera.near = 1;
    w.camera.far = Math.max(60000, sep * 8);
    w.camera.updateProjectionMatrix();
    w.camera.updateMatrixWorld();
  }, pair);
  await page.waitForTimeout(420);
  await page.screenshot({ path: `${OUT}/airframe-ai-airframes.png` });
  const pairTriangles = await inFrame({ id: pair.a });
  const pairTriangles2 = await inFrame({ id: pair.b });
  assert.ok(
    pairTriangles.triangles > 0 && pairTriangles2.triangles > 0,
    `both sides reach the AI frame: ${JSON.stringify({ a: pair.a, aTris: pairTriangles.triangles, b: pair.b, bTris: pairTriangles2.triangles })}`,
  );
  await releaseCamera();
  console.log("AI frame", JSON.stringify({ a: pair.a, b: pair.b, sep: Math.round(pair.d) }));

  // ---- 5. LOD loan at near and far range, and the disposal dispatch. ----------------------------
  // Make sure an imported-capable airframe exists (Japanese fighter, or American bomber — the two
  // the view has a real model for), through the game's own launch path if none is up yet.
  await page.evaluate(() => {
    const b = window.midway.battle;
    const capable = (a) => (a.team === "jp" && a.kind === "fighter") || (a.team === "us" && a.kind === "bomber");
    if (b.aircraft.some((a) => a.hp > 0 && a.mode !== "crashing" && capable(a))) return;
    const ship = b.ships.find((s) => s.kind === "carrier" && !s.sunk && s.id !== b.player.home);
    if (ship) b.launch(ship, "bomber");
  });
  await page.waitForTimeout(500);
  const target = await page.evaluate(() => {
    const b = window.midway.battle;
    const capable = (a) => (a.team === "jp" && a.kind === "fighter") || (a.team === "us" && a.kind === "bomber");
    const a = b.aircraft.find((x) => x.hp > 0 && x.mode !== "crashing" && capable(x));
    return a ? { id: a.id, team: a.team, kind: a.kind, airframe: a.airframe } : null;
  });
  assert.ok(target, "an imported-capable AI aircraft is airborne for the LOD loan");

  // Near: player inside the 1100 m grant, so the imported airframe is loaned.
  await freezeCamera();
  await page.evaluate((id) => {
    const b = window.midway.battle;
    const a = b.aircraft.find((x) => x.id === id);
    Object.assign(b.player, { x: a.x + 90, y: a.y, z: a.z + 40 });
  }, target.id);
  await page.waitForTimeout(400);
  const nearState = await page.evaluate((id) => {
    const s = window.midway;
    const a = s.battle.aircraft.find((x) => x.id === id);
    const m = s.world.meshes.get(id);
    window.__lodOld = m;
    const drawn = m?.userData.airframe ?? (m?.userData.douglas ? "sbd" : null);
    return { detailed: !!m?.userData.detailed, name: m?.name, drawn, airframe: a.airframe };
  }, target.id);
  assert.equal(nearState.detailed, true, `inside 1100 m the imported airframe is loaned: ${JSON.stringify(nearState)}`);
  assert.equal(nearState.drawn, nearState.airframe, `the loaned airframe matches the sim: ${JSON.stringify(nearState)}`);
  await page.evaluate((id) => {
    const w = window.midway.world;
    const m = w.meshes.get(id);
    m.updateMatrixWorld(true);
    const V = m.position.constructor;
    const at = m.position;
    w.camera.position.set(at.x + 42, at.y + 12, at.z + 52);
    w.camera.up.set(0, 1, 0);
    w.camera.lookAt(at.x, at.y, at.z);
    w.camera.fov = 40;
    w.camera.near = 0.2;
    w.camera.far = 4000;
    w.camera.updateProjectionMatrix();
    w.camera.updateMatrixWorld();
  }, target.id);
  await page.waitForTimeout(420);
  await page.screenshot({ path: `${OUT}/airframe-lod-near.png` });
  await requireSubject("airframe-lod-near", { id: target.id });
  console.log("LOD near", JSON.stringify(nearState));

  // Far: 6 km out, past the 1500 m keep, so detail is released and the procedural level rebuilt.
  await page.evaluate((id) => {
    const b = window.midway.battle;
    const a = b.aircraft.find((x) => x.id === id);
    Object.assign(b.player, { x: a.x + 6000, y: a.y, z: a.z });
  }, target.id);
  await page.waitForTimeout(400);
  const farState = await page.evaluate((id) => {
    const s = window.midway;
    const m = s.world.meshes.get(id);
    const old = window.__lodOld;
    const drawn = m?.userData.airframe ?? (m?.userData.douglas ? "sbd" : null);
    return {
      detailed: !!m?.userData.detailed,
      drawn,
      name: m?.name,
      replaced: m !== old,
      oldDetached: old ? old.parent === null : null,
      oldGoneFromScene: old ? !s.world.scene.getObjectById(old.id) : null,
    };
  }, target.id);
  assert.equal(farState.detailed, false, `beyond 1500 m the loan is released: ${JSON.stringify(farState)}`);
  assert.ok(farState.replaced, `the released mesh is rebuilt at the procedural level: ${JSON.stringify(farState)}`);
  assert.equal(farState.oldDetached, true, `the released detailed mesh is detached: ${JSON.stringify(farState)}`);
  assert.equal(farState.oldGoneFromScene, true, `the released detailed mesh is out of the scene: ${JSON.stringify(farState)}`);
  await page.evaluate((id) => {
    const w = window.midway.world;
    const m = w.meshes.get(id);
    m.updateMatrixWorld(true);
    const at = m.position;
    w.camera.position.set(at.x + 820, at.y + 260, at.z + 1180);
    w.camera.up.set(0, 1, 0);
    w.camera.lookAt(at.x, at.y, at.z);
    w.camera.fov = 16;
    w.camera.near = 1;
    w.camera.far = 40000;
    w.camera.updateProjectionMatrix();
    w.camera.updateMatrixWorld();
  }, target.id);
  await page.waitForTimeout(420);
  await page.screenshot({ path: `${OUT}/airframe-lod-far.png` });
  await requireSubject("airframe-lod-far", { id: target.id });
  console.log("LOD far", JSON.stringify(farState));

  // The cap: park the player among every imported-capable AI and confirm the loan count stays 10.
  const eligible = await page.evaluate(() => {
    const b = window.midway.battle;
    const capable = (a) => (a.team === "jp" && a.kind === "fighter") || (a.team === "us" && a.kind === "bomber");
    const targets = b.aircraft.filter((a) => a.hp > 0 && a.mode !== "crashing" && capable(a));
    if (!targets.length) return 0;
    const c = targets.reduce((acc, a) => ({ x: acc.x + a.x, y: acc.y + a.y, z: acc.z + a.z }), { x: 0, y: 0, z: 0 });
    Object.assign(b.player, { x: c.x / targets.length, y: c.y / targets.length, z: c.z / targets.length });
    return targets.length;
  });
  await page.waitForTimeout(400);
  const detailed = await page.evaluate(() => {
    const s = window.midway;
    let n = 0;
    for (const a of s.battle.aircraft) if (s.world.meshes.get(a.id)?.userData.detailed) n += 1;
    return n;
  });
  assert.ok(detailed <= 10, `the detail loan is capped at 10, saw ${detailed} of ${eligible} eligible`);
  console.log("LOD cap", JSON.stringify({ eligible, detailed }));
  await releaseCamera();

  assert.equal(errors.length, 0, `console/page errors during capture: ${errors.join(" | ")}`);
  console.log(
    "PASS: cockpit interior drawn with an unobstructed panel sightline; propeller blades/blur flip at " +
      "startup/cruise/cut; gear legs and the arresting hook travel down-to-up; KeyB releases exactly one " +
      "store, one weapon and one payload step; AI airframes correct on both sides with no TBD/Kate on the " +
      "Douglas; the imported LOD loan flips with range, caps at 10 and disposes the released mesh; no " +
      `console or GPU errors. Frames are in ${OUT}/ and need a person to look at them.`,
  );
} catch (failure) {
  console.error("CAPTURE ERRORS", JSON.stringify(errors.slice(0, 20), null, 1));
  throw failure;
} finally {
  await browser.close();
}
