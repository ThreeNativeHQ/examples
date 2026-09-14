/**
 * Focused capture for the player's imported Devastator (PRD AC-3/4).
 *
 * Chooses the TBD from the real briefing and checks the three views the acceptance criterion names
 * — deck, chase and cockpit — plus the moving parts the runtime now consumes from the shipped
 * clips. The articulation state is injected and the sim is paused to hold it, so that frame is
 * labelled. Identity, camera and store checks read the live objects, not a screenshot.
 */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const URL = process.env.MIDWAY_URL || "http://127.0.0.1:5326";
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  // The shared checkout is edited while this runs; a Vite HMR update tears the live game down
  // mid-capture. The scene needs no hot updates, so the HMR socket is silenced and the page keeps
  // the snapshot it booted with. (The private dev server also runs with hmr disabled.)
  await page.addInitScript(() => {
    class SilentSocket {
      readyState = 0;
      addEventListener() {}
      removeEventListener() {}
      send() {}
      close() {}
    }
    window.WebSocket = SilentSocket;
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await mkdir(OUT, { recursive: true });

  const boot = async () => {
    await page.goto(URL);
    await page.waitForSelector("#loading.hidden", { state: "attached", timeout: 120000 });
    await page.waitForSelector("#briefing:not(.hidden)");
    await page.evaluate(async () => {
      // Newest first, but an edit to the import graph gives Vite a second `game.ts?t=…` whose
      // game was never started; the live one is the module whose scene has a battle. Re-read the
      // list each pass: a hot reload can land another entry while we wait for the battle to exist.
      const deadline = Date.now() + 25000;
      let tried = [];
      while (Date.now() < deadline) {
        const urls = performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .filter((n) => /\/src\/game\.ts(?:\?|$)/.test(n))
          .reverse();
        tried = urls;
        for (const url of urls) {
          try {
            const scene = (await import(url)).default.scene;
            if (scene?.battle) {
              window.midway = scene;
              return;
            }
          } catch {
            // A module mid-reload is not the one we need.
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      throw new Error(`No loaded game module holds a running scene; tried ${tried.length}: ${tried.join(", ")}`);
    });
  };
  const pickDevastator = async () => {
    await page.click("#loadout-torpedo");
    const chosen = await page.evaluate(() => ({
      loadout: window.midway.battle.player.loadout,
      airframe: window.midway.battle.player.airframe,
    }));
    assert.equal(chosen.airframe, "tbd", `briefing must select the Devastator: ${JSON.stringify(chosen)}`);
    return chosen;
  };
  const playerReadback = () =>
    page.evaluate(() => {
      const m = window.midway.world.playerMesh;
      return {
        name: m.name,
        airframe: m.userData.airframe,
        devastator: !!m.userData.devastator,
        propeller: !!m.getObjectByName("propeller"),
        gear: !!m.getObjectByName("gearleft"),
        flap: !!m.getObjectByName("flapleft"),
        douglasNode: !!m.getObjectByName("defaultMaterial_node_15"),
        cockpitEye: !!m.userData.cockpit,
        store: !!m.userData.torpedoLoad,
      };
    });
  const quats = () =>
    page.evaluate(() => {
      const m = window.midway.world.playerMesh;
      const q = (name) => m.getObjectByName(name).quaternion.toArray().map((x) => +x.toFixed(4));
      return {
        aileron: q("aileronleft"),
        elevator: q("elevator"),
        flap: q("flapleft"),
        gear: q("gearleft"),
        rudder: q("rudder"),
      };
    });
  const differs = (a, b) => Object.keys(a).some((k) => a[k].some((v, i) => Math.abs(v - b[k][i]) > 0.02));
  const loadThree = () =>
    page.evaluate(async () => {
      const urls = performance.getEntriesByType("resource").map((e) => e.name).filter((n) => /\.js(\?|$)/.test(n) && /three/i.test(n));
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
  // Probe the ACTUAL game camera: does any ray land on an aircraft that is not the player's?
  const deckProbe = () =>
    page.evaluate(() => {
      const s = window.midway;
      const T = window.__T;
      const w = s.world;
      const fromPlayer = (o) => {
        for (let n = o; n; n = n.parent) if (n === w.playerMesh) return true;
        return false;
      };
      const isAircraft = (o) => {
        for (let n = o; n; n = n.parent) if (n.userData?.importedAircraft || n.userData?.detailed) return true;
        return false;
      };
      const cam = w.camera;
      cam.updateMatrixWorld(true);
      let near = null;
      for (const [x, y] of [[0, 0], [-0.5, -0.2], [-0.6, 0], [0.5, -0.2], [0.6, 0], [0, 0.2]]) {
        const r = new T.Raycaster();
        r.setFromCamera(new T.Vector2(x, y), cam);
        const hit = r
          .intersectObjects(w.scene.children, true)
          .filter((h) => h.object.visible && !(h.object.material?.transparent))[0];
        if (hit && isAircraft(hit.object) && !fromPlayer(hit.object) && (!near || hit.distance < near.distance))
          near = { distance: +hit.distance.toFixed(2), name: hit.object.name || hit.object.type };
      }
      return { camera: cam.position.toArray().map((v) => +v.toFixed(1)), mode: w.cameraMode, near };
    });
  // A paused, composed frame around the live player object. This is an ASSET INSPECTION shot only;
  // the live default-camera frames below are the deck proof.
  const holdCamera = () =>
    page.evaluate(() => {
      const s = window.midway;
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
  const composedShot = async (name, offset) => {
    await page.evaluate(([dx, dy, dz]) => {
      const w = window.midway.world;
      const V = w.camera.position.constructor;
      const at = w.playerMesh.getWorldPosition(new V());
      w.camera.position.set(at.x + dx, at.y + dy, at.z + dz);
      w.camera.lookAt(at.x, at.y + 1.4, at.z);
      w.camera.fov = 40;
      w.camera.up.set(0, 1, 0);
      w.camera.updateProjectionMatrix();
      w.camera.updateMatrixWorld();
    }, offset);
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${OUT}/${name}.png` });
  };

  // Phase A — the default SBD on deck with the actual game camera: the fix must not regress it.
  await boot();
  await page.click("#start-deck");
  await page.waitForFunction(() => document.getElementById("briefing").classList.contains("hidden"));
  await page.waitForTimeout(900);
  await loadThree();
  const sbdDeck = await deckProbe();
  assert.ok(
    !sbdDeck.near || sbdDeck.near.distance > 2,
    `SBD deck camera stays clear of parked aircraft: ${JSON.stringify(sbdDeck)}`,
  );
  await page.screenshot({ path: `${OUT}/sbd-deck-live.png` });

  // Phase B — the Devastator on deck: the ACTUAL game camera, from real briefing input.
  await boot();
  await pickDevastator();
  await page.click("#start-deck");
  await page.waitForFunction(() => document.getElementById("briefing").classList.contains("hidden"));
  await page.waitForTimeout(900);
  const deck = await playerReadback();
  assert.ok(deck.devastator, `player Devastator is the ported airframe: ${JSON.stringify(deck)}`);
  assert.equal(deck.name, "Douglas TBD-1 Devastator");
  assert.equal(deck.airframe, "tbd");
  assert.ok(deck.propeller && deck.gear && deck.flap, "the supplied moving parts are present");
  assert.equal(deck.douglasNode, false, "no Douglas canopy node masquerades on the TBD");
  await loadThree();
  const tbdDeck = await deckProbe();
  assert.ok(
    !tbdDeck.near || tbdDeck.near.distance > 2,
    `TBD deck camera is clear of the parked row: ${JSON.stringify(tbdDeck)}`,
  );
  await page.screenshot({ path: `${OUT}/tbd-deck-live.png` });
  // A labelled ASSET INSPECTION frame may accompany the live proof; it never substitutes for it.
  await holdCamera();
  await composedShot("tbd-deck-asset-inspection", [15, 6.5, -16]);
  await releaseCamera();
  await page.evaluate(() => window.midway.world.setCamera(1));
  await page.waitForTimeout(500);
  const cockpitEye = await page.evaluate(() => {
    const m = window.midway.world.playerMesh;
    const w = window.midway.world.camera.getWorldPosition(new (m.position.constructor)());
    const e = m.userData.cockpit ? m.localToWorld(m.userData.cockpit.clone()) : null;
    return {
      cockpit: !!m.userData.cockpit,
      distance: e ? +w.distanceTo(e).toFixed(3) : null,
      exteriorHidden: m.getObjectByName("airframebody") ? true : null,
    };
  });
  assert.ok(cockpitEye.cockpit, "the TBD mounts its own instrument panel and eye point");
  assert.ok(cockpitEye.distance < 0.5, `cockpit camera sits on the TBD eye: ${JSON.stringify(cockpitEye)}`);
  await page.screenshot({ path: `${OUT}/tbd-cockpit-deck.png` });

  // Phase C — airborne: a real chase frame, then the labelled moving-part range.
  await boot();
  await pickDevastator();
  await page.click("#start-air");
  await page.waitForFunction(() => document.getElementById("briefing").classList.contains("hidden"));
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.midway.world.setCamera(0));
  await page.waitForTimeout(400);
  const chaseDistance = await page.evaluate(() => {
    const w = window.midway.world;
    const V = w.camera.position.constructor;
    return +w.camera.position.distanceTo(w.playerMesh.getWorldPosition(new V())).toFixed(1);
  });
  assert.ok(
    chaseDistance > 10 && chaseDistance < 60,
    `airborne chase keeps its aft framing, not the deck-offset: ${chaseDistance} m`,
  );
  await page.screenshot({ path: `${OUT}/tbd-chase.png` });

  // LABELLED INJECTION: freeze the sim and set the exact control values the clips consume.
  const inject = (state) =>
    page.evaluate((values) => {
      window.midway.paused = true;
      Object.assign(window.midway.battle.player, values);
    }, state);
  await inject({ rpm: 0, elevator: 0, controlAileron: 0, aileron: 0, rudder: 0, flapPos: 0, gearPos: 1, torpedo: 1 });
  await page.waitForTimeout(400);
  const neutral = await quats();
  await inject({ rpm: 0.9, elevator: 1, controlAileron: 1, aileron: 1, rudder: -1, flapPos: 1, gearPos: 0, torpedo: 1 });
  await page.waitForTimeout(500);
  const deflected = await quats();
  for (const part of ["aileron", "elevator", "flap", "gear", "rudder"])
    assert.ok(differs({ [part]: neutral[part] }, { [part]: deflected[part] }), `${part} follows its clip`);
  const rig = await page.evaluate(() => {
    const m = window.midway.world.playerMesh;
    return {
      propellerHidden: m.getObjectByName("propeller").visible === false,
      blurVisible: m.getObjectByName("Propeller motion blur").visible === true,
      storeVisible: m.userData.torpedoLoad.visible === true,
    };
  });
  assert.ok(rig.propellerHidden && rig.blurVisible, "the running propeller hands off to its blur");
  assert.ok(rig.storeVisible, "the torpedo store is visible while carried");
  await page.screenshot({ path: `${OUT}/tbd-articulation-injected.png` });
  await inject({ torpedo: 0, rpm: 0 });
  await page.waitForTimeout(400);
  const released = await page.evaluate(() => window.midway.world.playerMesh.userData.torpedoLoad.visible);
  assert.equal(released, false, "releasing the store removes exactly the one visible store");

  assert.deepEqual(errors, []);
  console.log(
    "PASS: real briefing input takes the Devastator deck with the game camera clear of the parked row " +
      "(SBD deck and airborne chase unregressed), imported airframe in deck/chase/cockpit, labelled " +
      "injected articulation drives gear/flap/surfaces and the visible store; no console errors",
  );
} catch (failure) {
  console.error("CAPTURE ERRORS", JSON.stringify(errors.slice(0, 20), null, 1));
  throw failure;
} finally {
  await browser.close();
}
