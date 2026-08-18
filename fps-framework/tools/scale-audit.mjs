// `pnpm scale` — the metric truth about this scene.
//
// Nothing else in this repo can see a scale mismatch. `typecheck` passes on a 2.68 m
// soldier, `pnpm test` passes on a 1.43 m rifle, and a screenshot only tells you something
// feels big. This drives the real WebGPU build, measures every physical object in world
// space, and compares it against `src/render/scale.ts` — the one place a real-world size
// is declared. A model that arrives in centimetres fails a command instead of shipping.
//
//   pnpm scale                 measure and report; exit 1 on any FAIL
//   pnpm scale --ruler         also drop a 1.78 m human-height pole beside each subject
//                              and screenshot it, for when a number is not convincing
//   pnpm scale --report        write screenshots/scale-audit.json for diffing runs
//   pnpm scale --url <url>     measure an already-running server instead of starting one
//
// Two constraints inherited from every probe in this project, both learned the hard way:
// a bare `three` specifier does not resolve inside `page.evaluate` (Vite serves the
// module by path), and headless Chromium cannot render WebGPU — this runs headed.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback;
};

const PORT = Number(value("port", 5184));
const externalUrl = value("url", undefined);
const url = externalUrl ?? `http://127.0.0.1:${PORT}/`;
const wantRuler = flag("ruler");
const wantReport = flag("report") || wantRuler;

/** Start the dev server ourselves unless we were pointed at one. */
async function startServer() {
  if (externalUrl !== undefined) return undefined;
  const child = spawn(
    "npx",
    ["vite", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
  );
  await new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error("dev server did not start in 30 s")), 30_000);
    child.stdout.on("data", (chunk) => {
      if (String(chunk).includes("ready in")) {
        clearTimeout(timer);
        ok();
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      fail(new Error(`dev server exited with ${code}`));
    });
  });
  return child;
}

const server = await startServer();
const browser = await chromium.launch({
  headless: false,
  args: [
    "--ozone-platform=x11",
    "--enable-unsafe-webgpu",
    "--disable-gpu-sandbox",
    "--ignore-gpu-blocklist",
    "--enable-features=Vulkan",
  ],
});

let exitCode = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error).slice(0, 200)));
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => window.__THREENATIVE__?.snapshot !== undefined, {
    timeout: 60_000,
  });
  // Let the scene settle so animated bones are posed, not in bind pose.
  await page.waitForTimeout(4_000);

  const measured = await page.evaluate(async () => {
    const { default: game } = await import("/src/game.ts");
    const THREE = await import("/node_modules/three/build/three.module.js");
    const { SCALE_EXPECTATIONS, scale } = await import("/src/render/scale.ts");
    const ctx = game.ctx;

    const subjects = [];
    const box = new THREE.Box3();
    const size = new THREE.Vector3();
    const add = (subject, label, dimensions, extra = {}) =>
      subjects.push({ subject, label, ...dimensions, ...extra });
    const boxOf = (object) => {
      object.updateWorldMatrix(true, true);
      box.setFromObject(object);
      if (!Number.isFinite(box.min.x)) return undefined;
      box.getSize(size);
      return {
        width: +size.x.toFixed(3),
        height: +size.y.toFixed(3),
        depth: +size.z.toFixed(3),
        longest: +Math.max(size.x, size.y, size.z).toFixed(3),
        minY: +box.min.y.toFixed(3),
      };
    };

    // --- Characters. Bone-accurate: a Box3 over a skinned mesh reports the bind pose.
    let hitbox;
    ctx.scene.traverse((object) => {
      if (hitbox === undefined && object.userData?.enemy !== undefined) hitbox = object;
    });
    const enemy = hitbox?.userData.enemy;
    if (enemy !== undefined) {
      add("enemy", "enemy soldier (bone-accurate)", {
        height: +enemy.modelHeight.toFixed(3),
        longest: +enemy.modelHeight.toFixed(3),
        width: null,
        depth: null,
      }, { groundClearance: null });
      const hitboxSize = boxOf(hitbox);
      if (hitboxSize !== undefined) add("enemy-hitbox", "enemy hitbox proxy", hitboxSize);

      // The AK lives in a holder group parented to the right-hand bone.
      let holder;
      enemy.group.traverse((object) => {
        if (
          holder === undefined &&
          object.type === "Group" &&
          object.parent?.isBone === true &&
          object.getObjectByName?.("Grip_Bone") !== undefined
        ) {
          holder = object;
        }
      });
      const weapon = holder === undefined ? undefined : boxOf(holder);
      if (weapon !== undefined) add("enemy-weapon", "enemy AK (rendered)", weapon);
    }

    const player = ctx.scene.getObjectByName("player");
    const playerSize = player === undefined ? undefined : boxOf(player);
    if (playerSize !== undefined) add("player", "player collider", playerSize);

    // The viewmodel is welded to the camera; its world box is still its real size.
    const rifleGroup = ctx.camera.children.find((child) => child.renderOrder === 20);
    const viewmodel = rifleGroup?.children.find((child) => child.type === "Group");
    const viewmodelSize = viewmodel === undefined ? undefined : boxOf(viewmodel);
    if (viewmodelSize !== undefined) add("player-viewmodel", "player viewmodel rifle", viewmodelSize);

    // --- Range props, by the names range.ts assigns.
    const unlabelled = [];
    const range = ctx.scene.getObjectByName("range");
    range?.traverse((object) => {
      if (object.isMesh !== true) return;
      if (object.userData?.target !== undefined) {
        const plate = boxOf(object);
        if (plate !== undefined) add("target-plate", "target plate", plate);
        return;
      }
      const name = object.name;
      if (name === "" || name === undefined) {
        unlabelled.push(object.geometry?.type ?? "unknown");
        return;
      }
      const props = boxOf(object);
      if (props !== undefined) add(name, name, props);
    });

    // --- Effect sprites, which read as scale cues even though they are not solid.
    let flash;
    ctx.scene.traverse((object) => {
      if (
        flash === undefined &&
        object.geometry?.type === "PlaneGeometry" &&
        object.material?.blending === THREE.AdditiveBlending &&
        (object.name === "muzzle-flash" || object.geometry.parameters.width > 0.4)
      ) {
        flash = object;
      }
    });
    if (flash !== undefined) {
      const parameters = flash.geometry.parameters;
      add("muzzle-flash", "muzzle flash quad", {
        width: +parameters.width.toFixed(3),
        height: +parameters.height.toFixed(3),
        depth: 0,
        longest: +Math.max(parameters.width, parameters.height).toFixed(3),
      });
    }

    return { subjects, unlabelled, expectations: SCALE_EXPECTATIONS, declared: scale };
  });

  // --- Compare. A check whose subject was never found is a FAIL, not a skip: a renamed
  // prop must break the audit rather than quietly stop being measured.
  const rows = [];
  for (const check of measured.expectations) {
    const found = measured.subjects.filter((item) => item.subject === check.subject);
    if (found.length === 0) {
      rows.push({
        subject: check.subject,
        axis: check.axis,
        status: check.optional === true ? "SKIP" : "FAIL",
        detail: "no object with this name in the scene",
      });
      continue;
    }
    for (const item of found) {
      const actual = item[check.axis];
      if (actual === null || actual === undefined) {
        rows.push({
          subject: check.subject,
          axis: check.axis,
          status: "FAIL",
          detail: `${check.axis} not measurable`,
        });
        continue;
      }
      // A `match` check is relative: read the reference subject's live measurement.
      let target = check.metres;
      if (check.kind === "match") {
        const reference = measured.subjects.find((item) => item.subject === check.reference);
        const referenceValue = reference?.[check.axis];
        if (referenceValue === null || referenceValue === undefined) {
          exitCode = 1;
          rows.push({
            subject: check.subject,
            axis: check.axis,
            status: "FAIL",
            detail: `reference "${check.reference}" not measurable`,
          });
          continue;
        }
        target = referenceValue;
      }
      const limit =
        check.kind === "max"
          ? { low: 0, high: target }
          : {
              low: target * (1 - (check.tolerance ?? 0.1)),
              high: target * (1 + (check.tolerance ?? 0.1)),
            };
      const pass = actual >= limit.low && actual <= limit.high;
      if (!pass) exitCode = 1;
      rows.push({
        subject: check.subject,
        label: item.label,
        axis: check.axis,
        actual,
        expected:
          check.kind === "max"
            ? `≤ ${target} m`
            : `${limit.low.toFixed(2)}–${limit.high.toFixed(2)} m` +
              (check.kind === "match" ? ` (= ${check.reference})` : ""),
        ratio: +(actual / target).toFixed(2),
        status: pass ? "PASS" : "FAIL",
        note: check.note,
      });
    }
  }

  const width = Math.max(...rows.map((row) => (row.label ?? row.subject).length), 22);
  console.log("\n  SCALE AUDIT — measured against src/render/scale.ts\n");
  for (const row of rows) {
    const mark = row.status === "PASS" ? "  ok " : row.status === "SKIP" ? " skip" : "FAIL";
    const actual = row.actual === undefined ? "—" : `${row.actual.toFixed(3)} m`;
    console.log(
      `  ${mark}  ${(row.label ?? row.subject).padEnd(width)}  ${row.axis.padEnd(7)}` +
        `  ${actual.padStart(9)}  expected ${row.expected ?? row.detail}` +
        (row.status === "FAIL" && row.ratio !== undefined ? `  (${row.ratio}×)` : ""),
    );
  }
  if (measured.unlabelled.length > 0) {
    console.log(
      `\n  ${measured.unlabelled.length} unlabelled mesh(es) not measured: ` +
        `${[...new Set(measured.unlabelled)].join(", ")}`,
    );
  }
  const failures = rows.filter((row) => row.status === "FAIL").length;
  console.log(
    `\n  ${rows.length - failures}/${rows.length} checks pass` +
      (failures > 0 ? ` — ${failures} FAIL` : "") +
      (pageErrors.length > 0 ? `; ${pageErrors.length} page error(s)` : "") +
      "\n",
  );

  if (wantRuler) {
    // A number says the soldier is 2.68 m. A 1.78 m pole standing next to it says it
    // faster, and survives being pasted into a review. The subject is walked in front of
    // the camera first — a comparison you have to squint at is not a comparison.
    await page.evaluate(async (humanHeight) => {
      const THREE = await import("/node_modules/three/build/three.module.js");
      const { default: game } = await import("/src/game.ts");
      const ctx = game.ctx;
      const camera = ctx.camera;
      camera.updateMatrixWorld(true);
      const eye = camera.getWorldPosition(new THREE.Vector3());
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(
        camera.getWorldQuaternion(new THREE.Quaternion()),
      );
      forward.y = 0;
      forward.normalize();

      /** A striped pole of a known height, so the eye can read the ratio directly. */
      const ruler = (at, height, colour) => {
        const bands = 10;
        for (let index = 0; index < bands; index += 1) {
          const band = new THREE.Mesh(
            new THREE.CylinderGeometry(0.045, 0.045, height / bands, 10),
            new THREE.MeshBasicMaterial({ color: index % 2 === 0 ? colour : 0xf7f7f7 }),
          );
          band.position.set(at.x, at.y + (index + 0.5) * (height / bands), at.z);
          band.renderOrder = 5;
          ctx.scene.add(band);
        }
      };

      const stand = eye.clone().addScaledVector(forward, 6).setY(0);
      let hitbox;
      ctx.scene.traverse((object) => {
        if (hitbox === undefined && object.userData?.enemy !== undefined) hitbox = object;
      });
      if (hitbox !== undefined) {
        // Bring the subject to the camera rather than hunting it around the yard.
        const enemy = hitbox.userData.enemy;
        enemy.group.position.set(stand.x + 0.9, enemy.group.position.y, stand.z);
        enemy.group.rotation.y = Math.atan2(eye.x - stand.x, eye.z - stand.z);
      }
      ruler(stand, humanHeight, 0xff3b30);

      // A second pole at each labelled prop, for the props the table flagged.
      const range = ctx.scene.getObjectByName("range");
      for (const name of ["locker", "barricade", "drum"]) {
        const prop = range?.getObjectByName(name);
        if (prop === undefined) continue;
        const at = prop.getWorldPosition(new THREE.Vector3());
        ruler(new THREE.Vector3(at.x + 1.2, 0, at.z + 1.2), humanHeight, 0xffb020);
      }
    }, measured.declared.humanHeight);
    await page.waitForTimeout(400);
    mkdirSync(resolve(root, "screenshots"), { recursive: true });
    await page.screenshot({ path: resolve(root, "screenshots/scale-ruler.png") });
    console.log("  ruler screenshot: screenshots/scale-ruler.png");
    console.log(`  red pole = ${measured.declared.humanHeight} m, the height a soldier should be\n`);
  }

  if (wantReport) {
    mkdirSync(resolve(root, "screenshots"), { recursive: true });
    writeFileSync(
      resolve(root, "screenshots/scale-audit.json"),
      `${JSON.stringify({ rows, subjects: measured.subjects, pageErrors }, null, 2)}\n`,
    );
    console.log("  report: screenshots/scale-audit.json\n");
  }
} catch (error) {
  console.error(`  scale audit failed to run: ${String(error)}`);
  exitCode = 1;
} finally {
  await browser.close();
  server?.kill();
}
process.exit(exitCode);
