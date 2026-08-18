// Measures the animated enemy and equipped rifle in world space. This is deliberately
// numeric: screenshots tell us that a pose looks wrong; these invariants tell us why.
import { chromium } from "playwright";

const url = process.argv[2] ?? "http://127.0.0.1:5180/";
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

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => window.__THREENATIVE__?.snapshot !== undefined, {
    timeout: 60_000,
  });
  await page.waitForTimeout(6_000);

  const setup = await page.evaluate(async () => {
    const { default: game } = await import("/src/game.ts");
    const ctx = game.ctx;
    let hitbox;
    ctx.scene.traverse((object) => {
      if (hitbox === undefined && object.userData?.enemy !== undefined) hitbox = object;
    });
    const enemy = hitbox?.userData.enemy;
    if (enemy === undefined) throw new Error("enemy entity was not found");
    let rightHand = enemy.group.getObjectByName("mixamorigRightHand");
    enemy.group.traverse((object) => {
      if (rightHand === undefined && /right.*hand|hand.*r$|hand_r/i.test(object.name)) {
        rightHand = object;
      }
    });
    const grip = enemy.group.getObjectByName("Grip_Bone");
    if (rightHand === undefined || grip === undefined) {
      throw new Error("right hand or rifle Grip_Bone was not found");
    }
    let holder = grip;
    while (holder.parent !== null && holder.parent !== rightHand) holder = holder.parent;
    if (holder.parent !== rightHand) throw new Error("rifle holder is not attached to right hand");
    window.__TN_POSE__ = { ctx, enemy, holder };

    const original = holder.rotation.toArray();
    const originalPose = enemy.debug();
    const turns = [-Math.PI, -Math.PI / 2, 0, Math.PI / 2];
    const candidates = [];
    for (const x of turns) {
      for (const y of turns) {
        for (const z of turns) {
          holder.rotation.set(x, y, z);
          const pose = enemy.debug();
          // This GLB's Clip_Bone points opposite its visible magazine. Penalise support-hand
          // separation as well, so a barrel-only optimum cannot "pass" with a floating hand.
          const score =
            (pose.rifleForwardDot ?? -1) -
            (pose.clipMarkerDownDot ?? 1) -
            (pose.leftHandToRifle ?? 1) * 2;
          candidates.push({ euler: [x, y, z], score, pose });
        }
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    holder.rotation.fromArray(original);

    // Park the real player camera close enough for the screenshot to verify the same pose.
    const player = ctx.entities.get("player");
    const target = enemy.group.position;
    // A side-on view keeps the nearby barricade out of the attachment close-up.
    const facing = enemy.group.rotation.y + Math.PI / 2;
    const stand = {
      x: target.x + Math.sin(facing) * 2.4,
      y: 0.83,
      z: target.z + Math.cos(facing) * 2.4,
    };
    player.body.teleport(stand);
    player.mesh.position.set(stand.x, stand.y, stand.z);
    player.look.yaw = Math.atan2(stand.x - target.x, stand.z - target.z);
    player.look.pitch = -0.12;
    ctx.camera.fov = 38;
    ctx.camera.updateProjectionMatrix();
    player.syncCamera();
    return { best, originalPose, top: candidates.slice(0, 5) };
  });

  console.log(JSON.stringify({ stage: "orientation-sweep", ...setup }));
  const standing = setup.originalPose;
  if ((standing.rightHandToGrip ?? 1) > 0.01) throw new Error("right hand missed Grip_Bone");
  if ((standing.leftHandToRifle ?? 1) > 0.15) throw new Error("left hand missed the AK");
  if ((standing.clipMarkerDownDot ?? 1) > -0.15) throw new Error("AK is rolled upside down");
  if ((standing.rifleLength ?? 0) < 1.2) throw new Error("AK reads below full size");
  await page.screenshot({ path: "screenshots/pose-probe-standing.png" });
  await page.evaluate(() => window.__TN_POSE__.enemy.hurt(window.__TN_POSE__.ctx, 999));
  let elapsedMs = 0;
  let finalSample;
  for (const waitMs of [250, 750, 1_500, 2_500, 3_500]) {
    await page.waitForTimeout(waitMs - elapsedMs);
    const sample = await page.evaluate(() => window.__TN_POSE__.enemy.debug());
    finalSample = sample;
    console.log(JSON.stringify({ stage: `death-${waitMs}ms`, ...sample }));
    if (Math.abs(sample.bodyClearance ?? 1) > 0.02) {
      throw new Error(`dead body floated at ${waitMs}ms: ${sample.bodyClearance ?? "no sample"}m`);
    }
    elapsedMs = waitMs;
  }
  if (finalSample === undefined || Math.abs(finalSample.bodyClearance ?? 1) > 0.02) {
    throw new Error(`dead body missed ground: ${finalSample?.bodyClearance ?? "no sample"}m`);
  }
  for (const side of ["Left", "Right"]) {
    const foot = Object.entries(finalSample.bodyJoints).find(([name]) =>
      name.includes(`${side}Foot`),
    )?.[1];
    if (foot === undefined || foot[1] > 0.35) {
      throw new Error(`${side.toLowerCase()} foot stayed above ground: ${foot?.[1] ?? "missing"}m`);
    }
  }
  await page.screenshot({ path: "screenshots/pose-probe-dead.png" });
} finally {
  await browser.close();
}
