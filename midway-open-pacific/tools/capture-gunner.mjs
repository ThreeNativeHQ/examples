/**
 * Focused capture for the Douglas rear radioman/gunner (visual scope).
 *
 * The SBD is the default briefing aircraft, so no loadout switch is needed. The live objects are
 * read, not the pixels: the gunner is the deck crew's pilot rig, parented into the airframe, its
 * own skeleton playing the baked `sit` clip, seated under the canopy, published under `gunner`
 * (never `crew`, which the cockpit view hides) and untouched by cockpit view. One composed frame
 * per view is left for a person to look at.
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

  await page.goto(URL);
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
  await page.click("#start-deck");
  await page.waitForFunction(() => document.getElementById("briefing").classList.contains("hidden"));
  await page.waitForTimeout(900);

  const readback = () =>
    page.evaluate(() => {
      const w = window.midway.world;
      const m = w.playerMesh;
      const V = w.camera.position.constructor;
      const gunner = m.userData.gunner;
      const rig = m.userData.gunnerRig;
      const head = gunner.getObjectByName("Head");
      m.updateMatrixWorld(true);
      let parented = false;
      for (let n = gunner; n; n = n.parent) if (n === m) parented = true;
      return {
        airframe: m.userData.airframe,
        gunner: !!gunner,
        parented,
        clip: rig.current,
        // Aircraft-local, so a deck height or ship parent never enters the fit check.
        headY: +m.worldToLocal(head.getWorldPosition(new V())).y.toFixed(3),
        ownSkeleton: !!rig.mixer.getRoot(),
      };
    });

  const deck = await readback();
  assert.equal(deck.airframe, "sbd", `briefing must fly the SBD: ${JSON.stringify(deck)}`);
  assert.ok(deck.gunner, "the player Douglas seats the rear gunner");
  assert.ok(deck.parented, "the gunner is parented into the airframe, not the scene");
  assert.equal(deck.clip, "sit", `the gunner plays the seated clip: ${deck.clip}`);
  assert.ok(deck.ownSkeleton, "the gunner drives its own mixer");
  assert.ok(deck.headY > 0.6 && deck.headY < 1.184, `seated head under the canopy roof: ${deck.headY}`);
  await page.screenshot({ path: `${OUT}/gunner-deck-full.png` });

  // A paused, composed frame around the live gunner. Asset inspection only; the deck frame above
  // is the live proof.
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
  const composedShot = async (name, aft, starboard, up, lookUp) => {
    await page.evaluate(
      ([a, b, c, l]) => {
        const w = window.midway.world;
        const m = w.playerMesh;
        const V = w.camera.position.constructor;
        const Q = m.quaternion.constructor;
        m.updateMatrixWorld(true);
        const q = m.getWorldQuaternion(new Q());
        const fwd = new V(0, 0, -1).applyQuaternion(q);
        const upAxis = new V(0, 1, 0).applyQuaternion(q);
        const right = new V().crossVectors(fwd, upAxis).normalize();
        // The seated Head, not the gunner group: the group sits at the aircraft origin.
        const head = m.userData.gunner.getObjectByName("Head").getWorldPosition(new V());
        const focus = head.clone().addScaledVector(upAxis, l);
        w.camera.position
          .copy(head)
          .addScaledVector(fwd, -a)
          .addScaledVector(right, b)
          .addScaledVector(upAxis, c);
        w.camera.up.set(0, 1, 0);
        w.camera.lookAt(focus);
        w.camera.fov = 34;
        w.camera.updateProjectionMatrix();
        w.camera.updateMatrixWorld();
      },
      [aft, starboard, up, lookUp],
    );
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${OUT}/${name}.png` });
  };
  await holdCamera();
  // Rear three-quarter: behind and to starboard, looking down at the seated man and his mount.
  await composedShot("gunner-rear-quarter", 2.4, 1.35, 0.8, 0.05);
  // Side profile: abeam, level with the seat, so the seated posture and pan/backrest read.
  await composedShot("gunner-side-profile", 0.0, 2.5, 0.35, 0.02);
  await releaseCamera();

  // Cockpit view must not take him off the aircraft, and the seated head stays under the roof.
  await page.evaluate(() => window.midway.world.setCamera(1));
  await page.waitForTimeout(400);
  const cockpit = await page.evaluate(() => {
    const m = window.midway.world.playerMesh;
    const gunner = m.userData.gunner;
    const head = gunner.getObjectByName("Head");
    const V = m.position.constructor;
    m.updateMatrixWorld(true);
    return {
      visible: gunner.visible,
      headY: +m.worldToLocal(head.getWorldPosition(new V())).y.toFixed(3),
      roof: 1.184,
    };
  });
  assert.equal(cockpit.visible, true, "cockpit view leaves the rear gunner on the aircraft");
  assert.ok(cockpit.headY < cockpit.roof, `seated head under the canopy roof: ${cockpit.headY}`);
  await page.evaluate(() => window.midway.world.setCamera(0));
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/gunner-chase.png` });

  assert.deepEqual(errors, []);
  console.log(
    `PASS: rear gunner seated and playing 'sit' on the player Douglas (head y=${cockpit.headY} < roof ${cockpit.roof}), ` +
      "parented to the airframe, visible from the cockpit, no console errors. Captures: " +
      "gunner-rear-quarter, gunner-side-profile, gunner-deck-full, gunner-chase",
  );
} catch (failure) {
  console.error("CAPTURE ERRORS", JSON.stringify(errors.slice(0, 20), null, 1));
  throw failure;
} finally {
  await browser.close();
}
