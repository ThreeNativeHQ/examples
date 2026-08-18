// Tries candidate holder rotations for the rifle and writes one screenshot each, so the
// grip pose is chosen by looking at it instead of by reasoning about undocumented rig axes.
import { chromium } from "playwright";

const URL = process.argv[2] ?? "http://127.0.0.1:5180/";
const HALF = Math.PI / 2;
const CANDIDATES = [
  { name: "z90-y0", euler: [-HALF, 0, HALF] },
  { name: "z90-yp45", euler: [-HALF, HALF / 2, HALF] },
  { name: "z90-yp90", euler: [-HALF, HALF, HALF] },
  { name: "z90-ym90", euler: [-HALF, -HALF, HALF] },
  { name: "z90-y180", euler: [-HALF, Math.PI, HALF] },
];

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
const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
page.on("pageerror", (error) => console.log("PAGEERROR:", error.message.slice(0, 160)));
await page.goto(URL, { waitUntil: "load" });
await page.waitForFunction(() => window.__THREENATIVE__?.snapshot !== undefined, { timeout: 60_000 });
await page.waitForTimeout(7000);

await page.evaluate(async () => {
  const module = await import("/src/game.ts");
  window.__TN_GAME__ = module.default;
  const ctx = window.__TN_GAME__.ctx;
  let hitbox;
  ctx.scene.traverse((object) => {
    if (hitbox === undefined && object.userData?.enemy !== undefined) hitbox = object;
  });
  const enemy = hitbox.userData.enemy;
  enemy.phase = "dead";
  window.__TN_ENEMY__ = enemy;

  // Park the player in front of the enemy, facing it.
  const target = enemy.group.position;
  const facing = enemy.group.rotation.y;
  const stand = {
    x: target.x + Math.sin(facing) * 2.3,
    y: 0.83,
    z: target.z + Math.cos(facing) * 2.3,
  };
  const player = ctx.entities.get("player");
  player.body.teleport(stand);
  player.mesh.position.set(stand.x, stand.y, stand.z);
  player.look.yaw = Math.atan2(stand.x - target.x, stand.z - target.z);
  player.look.pitch = -0.08;
  ctx.camera.fov = 32;
  ctx.camera.updateProjectionMatrix();
  player.syncCamera();

  let holder;
  enemy.group.traverse((object) => {
    if (holder === undefined && object.type === "Group" && object.name === "" && object.children[0]?.name !== undefined && object.getObjectByName("Grip_Bone") !== undefined) {
      holder = object;
    }
  });
  window.__TN_HOLDER__ = holder;
  return holder !== undefined;
});

for (const candidate of CANDIDATES) {
  await page.evaluate((euler) => {
    window.__TN_HOLDER__.rotation.set(euler[0], euler[1], euler[2]);
    window.__TN_GAME__.ctx.entities.get("player").syncCamera();
  }, candidate.euler);
  await page.waitForTimeout(500);
  const out = `screenshots/grip-${candidate.name}.png`;
  await page.screenshot({ path: out });
  console.log("wrote", out);
}

await browser.close();
