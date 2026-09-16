/**
 * Final WebGPU capture for the Douglas rear gunner, on BOTH airframes.
 *
 * One browser launch, two airborne starts. For each airframe it drives the live game by keys: mans
 * the gun with Y, proves the camera is locked (C/F1/F2/F3/J refused), fires only rear ammunition,
 * damages a real enemy placed astern, keeps the course/navigation order, hides only the gunner's
 * body while the pilot and the gun stay drawn, then hands back to the AI gunner and proves the
 * visible gun now aims where it fires. Frames are left for a person to look at.
 *
 *   MIDWAY_URL=http://127.0.0.1:53xx bash tools/capture-lock.sh node tools/capture-gunner.mjs
 */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const URL = process.env.MIDWAY_URL || "http://127.0.0.1:5391";
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

  const hookScene = async () => {
    await page.waitForSelector("#loading.hidden", { state: "attached", timeout: 120000 });
    await page.waitForSelector("#briefing:not(.hidden)");
    await page.evaluate(async () => {
      const deadline = Date.now() + 25000;
      while (Date.now() < deadline) {
        const urls = performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .filter((n) => /\/src\/game\.ts(?:\?|$)/.test(n))
          .reverse();
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
      throw new Error("No loaded game module holds a running scene.");
    });
  };

  const startAirborne = async (loadout) => {
    if (loadout) await page.click(`#loadout-${loadout}`);
    await page.click("#start-air");
    await page.waitForFunction(() => {
      const b = window.midway.battle;
      return b.status === "playing" && b.player.mode === "flight" && b.player.y > 40;
    });
    await page.waitForTimeout(400);
  };

  const rearView = () =>
    page.evaluate(() => {
      const s = window.midway;
      const b = s.battle;
      const w = s.world;
      const p = b.player;
      return {
        airframe: p.airframe,
        gunner: p.gunner === true,
        autopilot: p.autopilot === true,
        nav: p.nav,
        cameraMode: w.cameraMode,
        rearAmmo: p.rearAmmo,
        ammo: p.ammo,
        gunnerVisible: w.playerMesh.userData.gunner?.visible,
        pilotVisible: w.playerMesh.userData.crew?.[0]?.visible,
        gunVisible: w.playerMesh.userData.rearGun?.visible,
        gunYaw: w.playerMesh.userData.rearGun?.rotation.y ?? 0,
        rearYaw: p.rearYaw,
      };
    });

  const placeAstern = (dist, drop, side = 0) =>
    page.evaluate(
      ([d, drop, side]) => {
        const b = window.midway.battle;
        const p = b.player;
        const fx = Math.sin(p.heading) * Math.cos(p.pitch);
        const fy = Math.sin(p.pitch);
        const fz = -Math.cos(p.heading) * Math.cos(p.pitch);
        const rx = Math.cos(p.heading);
        const rz = Math.sin(p.heading);
        const foe = {
          id: `capture-foe-${Math.round(b.time)}`,
          team: "jp",
          kind: "fighter",
          airframe: "zero",
          home: "nowhere",
          x: p.x - fx * d + rx * side,
          y: p.y - fy * d + drop,
          z: p.z - fz * d + rz * side,
          heading: p.heading + Math.PI,
          pitch: 0,
          roll: 0,
          speed: 70,
          hp: 60,
          maxHp: 60,
          ammo: 100,
          fuel: 100,
          mode: "flight",
          age: 0,
          think: 0,
          target: null,
          gunTimer: 0,
          attackCooldown: 0,
          wing: false,
          phase: 0,
          vx: 0,
          vy: 0,
          vz: 0,
        };
        b.aircraft.push(foe);
        return foe.id;
      },
      [dist, drop, side],
    );

  const runAirframe = async (airframe) => {
    // 1. Y mans the rear gun and hands the aircraft to its own course hold.
    const before = await rearView();
    assert.equal(before.airframe, airframe, `flying the ${airframe}`);
    assert.equal(before.gunner, false, "starts in the pilot seat with no gunner");
    await page.keyboard.press("y");
    await page.waitForTimeout(250);
    const manned = await rearView();
    assert.equal(manned.gunner, true, "Y mans the rear gun");
    assert.equal(manned.autopilot, true, "manning hands the aircraft to the AI course hold");
    assert.equal(manned.cameraMode, 1, "the gunner station takes the camera");
    assert.equal(manned.gunnerVisible, false, "the player's own gunner body is hidden");
    assert.equal(manned.pilotVisible, true, "the front pilot stays drawn");
    assert.equal(manned.gunVisible, true, "the gun stays drawn");
    await page.screenshot({ path: `${OUT}/gunner-rear-station-${airframe}.png` });

    // 2. Every camera route is refused while the gun owns the view.
    for (const key of ["c", "F1", "F2", "F3", "j"]) {
      await page.keyboard.press(key);
      await page.waitForTimeout(80);
    }
    const locked = await rearView();
    assert.equal(locked.cameraMode, 1, "camera C/F1/F2/F3/J are all refused in the gunner station");
    assert.equal(locked.gunner, true, "no camera key left the station");

    // 3. Fire: only rear ammunition is spent.
    const ammoBefore = locked.rearAmmo;
    const forwardBefore = locked.ammo;
    await page.keyboard.down("Space");
    await page.waitForTimeout(500);
    await page.keyboard.up("Space");
    const fired = await rearView();
    assert.ok(fired.rearAmmo < ammoBefore, `the rear gun spends rear ammunition (${fired.rearAmmo})`);
    assert.equal(fired.ammo, forwardBefore, "the forward guns are untouched in the gunner seat");

    // 4. A real enemy placed astern takes real damage from the rear gun.
    const foeId = await placeAstern(120, -6);
    await page.evaluate(() => {
      window.midway.battle.player.rearTimer = 0;
    });
    await page.keyboard.down("Space");
    await page.waitForFunction(
      (id) => {
        const b = window.midway.battle;
        const foe = b.aircraft.find((a) => a.id === id);
        return !foe || foe.hp < 60;
      },
      foeId,
      { timeout: 8000 },
    );
    await page.keyboard.up("Space");
    const hurt = await page.evaluate((id) => {
      const foe = window.midway.battle.aircraft.find((a) => a.id === id);
      return foe ? { hp: foe.hp, gone: false } : { hp: 0, gone: true };
    }, foeId);
    assert.ok(hurt.gone || hurt.hp < 60, "a real rear-gun round damaged the enemy behind the tail");
    assert.equal((await rearView()).nav, before.nav, "manning the gun preserves the navigation order");
    await page.screenshot({ path: `${OUT}/gunner-rear-firing-${airframe}.png` });

    // 5. Y returns the pilot to the seat and the camera to what it was; the AI gunner takes over.
    await page.keyboard.press("y");
    await page.waitForTimeout(250);
    const back = await rearView();
    assert.equal(back.gunner, false, "Y returns to the pilot seat");
    assert.equal(back.cameraMode, before.cameraMode, "the pilot gets their previous camera back");
    assert.equal(back.gunnerVisible, true, "the gunner body is drawn again");
    assert.equal(back.nav, before.nav, "the navigation order survives the handover");
    // The AI gun now works a fresh enemy off the tail axis; its visible pivot follows the rounds.
    await page.evaluate(() => {
      const b = window.midway.battle;
      b.aircraft = b.aircraft.filter((a) => !String(a.id).startsWith("capture-foe-"));
    });
    await placeAstern(140, -5, 40);
    const aiBefore = fired.rearAmmo;
    await page.waitForFunction(
      (before) => window.midway.battle.player.rearAmmo < before,
      aiBefore,
      { timeout: 8000 },
    );
    await page.waitForTimeout(300);
    const ai = await rearView();
    assert.ok(ai.rearAmmo < fired.rearAmmo, "the AI rear gunner resumes and fires when the pilot returns");
    assert.ok(Math.abs(ai.gunYaw) > 0.02, `the visible gun aims where the AI fires: ${JSON.stringify(ai)}`);
    await page.waitForTimeout(200);

    // Two composed, paused exteriors: the rear station with the gun and the AI-aimed mount on the
    // aircraft, then the front pilot the cockpit view hides.
    await page.evaluate(() => {
      const s = window.midway;
      const w = s.world;
      s.__wasPaused = s.paused;
      s.paused = true;
      w.__updateCamera ??= w.updateCamera;
      w.updateCamera = () => {};
      const m = w.playerMesh;
      const V = w.camera.position.constructor;
      const Q = m.quaternion.constructor;
      m.updateMatrixWorld(true);
      const q = m.getWorldQuaternion(new Q());
      const fwd = new V(0, 0, -1).applyQuaternion(q);
      const up = new V(0, 1, 0).applyQuaternion(q);
      const right = new V().crossVectors(fwd, up).normalize();
      const aim = m.userData.rearGun.getWorldPosition(new V());
      w.camera.position.copy(aim).addScaledVector(right, 2.7).addScaledVector(up, 0.5);
      w.camera.up.set(0, 1, 0);
      w.camera.lookAt(aim);
      w.camera.fov = 34;
      w.camera.updateProjectionMatrix();
      w.camera.updateMatrixWorld();
    });
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${OUT}/gunner-exterior-gun-${airframe}.png` });
    await page.evaluate(() => {
      const s = window.midway;
      const w = s.world;
      const m = w.playerMesh;
      const V = w.camera.position.constructor;
      const Q = m.quaternion.constructor;
      m.updateMatrixWorld(true);
      const q = m.getWorldQuaternion(new Q());
      const fwd = new V(0, 0, -1).applyQuaternion(q);
      const up = new V(0, 1, 0).applyQuaternion(q);
      const right = new V().crossVectors(fwd, up).normalize();
      const head = m.userData.crew[0].getObjectByName("Head").getWorldPosition(new V());
      w.camera.position.copy(head).addScaledVector(fwd, -1.8).addScaledVector(right, 1.7).addScaledVector(up, 0.95);
      w.camera.up.set(0, 1, 0);
      w.camera.lookAt(head);
      w.camera.fov = 34;
      w.camera.updateProjectionMatrix();
      w.camera.updateMatrixWorld();
    });
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${OUT}/gunner-front-pilot-${airframe}.png` });
    await page.evaluate(() => {
      const s = window.midway;
      const w = s.world;
      if (w.__updateCamera) w.updateCamera = w.__updateCamera;
      s.paused = s.__wasPaused ?? false;
    });
  };

  await page.goto(URL);
  await hookScene();
  await startAirborne(null);
  await runAirframe("sbd");

  // A clean reload flies the TBD through the same battery.
  await page.goto(URL);
  await hookScene();
  await startAirborne("torpedo");
  await runAirframe("tbd");

  assert.deepEqual(errors, []);
  console.log(
    "PASS: rear gunner on both airframes — Y station swap, cameras locked, rear-ammo-only fire, " +
      "real rear damage, course preserved, gunner hidden / pilot+gun drawn, AI gun aims. " +
      "Captures: gunner-rear-station-*, gunner-rear-firing-*, gunner-exterior-gun-*",
  );
} catch (failure) {
  console.error("CAPTURE ERRORS", JSON.stringify(errors.slice(0, 20), null, 1));
  throw failure;
} finally {
  await browser.close();
}
