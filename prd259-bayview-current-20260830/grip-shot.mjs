// Parks a camera on the enemy's hands and screenshots, so the rifle grip can be judged
// by looking at it rather than by reading the transform maths.
import { chromium } from "playwright";

const URL = process.argv[2] ?? "http://127.0.0.1:5180/";
const OUT = process.argv[3] ?? "screenshots/grip.png";

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
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (error) => console.log("PAGEERROR:", error.message.slice(0, 200)));
await page.goto(URL, { waitUntil: "load" });
await page.waitForFunction(() => window.__THREENATIVE__?.snapshot !== undefined, { timeout: 60_000 });
await page.waitForTimeout(8000);

await page.evaluate(async () => {
  const module = await import("/src/game.ts");
  window.__TN_GAME__ = module.default;
});

await page.evaluate((a) => { window.__TN_ANGLE__ = a; }, Number(process.argv[4] ?? 0));
const info = await page.evaluate(() => {
  const game = window.__TN_GAME__;
  const ctx = game.ctx;
  // Freeze the enemy where it stands so the shot is repeatable, then look at its chest.
  let hitbox;
  ctx.scene.traverse((object) => {
    if (hitbox === undefined && object.userData?.enemy !== undefined) hitbox = object;
  });
  const enemy = hitbox.userData.enemy;
  enemy.phase = "dead"; // stops the state machine walking it out of frame
  enemy.group.updateWorldMatrix(true, true);

  // FpsPlayer owns the camera every frame, so walk the player to the enemy and aim its
  // look instead of fighting syncCamera.
  const target = enemy.group.position;
  const player = ctx.entities.get?.("player") ?? window.__TN_PLAYER__;
  // Stand relative to the way the enemy faces, so "front" means its front.
  const facing = enemy.group.rotation.y;
  const angle = facing + Number(window.__TN_ANGLE__ ?? 0);
  const radius = 2.4;
  const stand = {
    x: target.x + Math.sin(angle) * radius,
    y: 0.83,
    z: target.z + Math.cos(angle) * radius,
  };
  player.body.teleport(stand);
  player.mesh.position.set(stand.x, stand.y, stand.z);
  // Camera forward is (-sin yaw, ., -cos yaw), so looking from `stand` at `target` is
  // yaw = atan2(-(dx), -(dz)) with d = target - stand.
  player.look.yaw = Math.atan2(stand.x - target.x, stand.z - target.z);
  player.look.pitch = -0.12;
  ctx.camera.fov = 38;
  ctx.camera.updateProjectionMatrix();
  player.syncCamera();

  // Report where the rifle actually sits relative to the hand that should hold it.
  const model = enemy.group.children[0];
  let hand;
  model.traverse((object) => {
    if (hand === undefined && /right.*hand|hand.*r$|hand_r/i.test(object.name)) hand = object;
  });
  const grip = enemy.group.getObjectByName("Grip_Bone");
  const holder = hand?.children?.find((child) => child.type === "Group");

  const measure = (object) => {
    if (object === undefined || object === null) return null;
    object.updateWorldMatrix(true, false);
    const position = new (target.constructor)();
    const scale = new (target.constructor)();
    position.setFromMatrixPosition(object.matrixWorld);
    scale.setFromMatrixScale(object.matrixWorld);
    return {
      name: object.name || object.type,
      world: position.toArray().map((n) => Number(n.toFixed(3))),
      worldScale: scale.toArray().map((n) => Number(n.toFixed(4))),
      localScale: object.scale.toArray().map((n) => Number(n.toFixed(4))),
    };
  };
  // How big is the rifle actually drawn, in metres?
  const weaponMesh = holder?.children?.[0];
  let renderedSize = null;
  if (weaponMesh !== undefined) {
    const box = new (window.__TN_BOX3__ ?? Object)();
    renderedSize = "unavailable";
  }
  return {
    enemyPos: target.toArray().map((n) => Number(n.toFixed(2))),
    hand: measure(hand),
    holder: measure(holder),
    gripBone: measure(grip),
    renderedSize,
  };
});

console.log(JSON.stringify(info));
await page.waitForTimeout(900);
await page.screenshot({ path: OUT });
console.log("wrote", OUT);
await browser.close();
