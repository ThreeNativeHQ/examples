// Reproduces the "enemy is invincible after it respawns" report and says which layer owns it.
//
// It kills the enemy the way a round does (`hurt`), waits past RESPAWN_SECONDS, and then fires
// the game's own hitscan straight at the respawned hitbox. If `hurt` still works but the ray
// stops finding the hitbox, the defect is in picking, not in the enemy state machine.
import { chromium } from "playwright";

const URL = process.argv[2] ?? "http://127.0.0.1:5180/";

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
await page.waitForTimeout(4000);

// Vite caches the module graph, so importing the entry hands back the live singleton.
await page.evaluate(async () => {
  const module = await import("/src/game.ts");
  window.__TN_GAME__ = module.default;
});

const observe = async (label) => {
  const out = await page.evaluate(() => {
    const game = window.__TN_GAME__;
    const ctx = game?.ctx;
    if (ctx === undefined) return { error: "no ctx" };

    let hitbox;
    ctx.scene.traverse((object) => {
      if (hitbox === undefined && object.userData?.enemy !== undefined) hitbox = object;
    });
    if (hitbox === undefined) return { error: "no enemy hitbox in scene" };
    const enemy = hitbox.userData.enemy;

    hitbox.updateWorldMatrix(true, false);
    const centre = { x: 0, y: 0, z: 0 };
    centre.x = hitbox.matrixWorld.elements[12];
    centre.y = hitbox.matrixWorld.elements[13];
    centre.z = hitbox.matrixWorld.elements[14];

    // Fire the game's own cast from 6 m in front of the hitbox, straight at its centre.
    const origin = { x: centre.x, y: centre.y, z: centre.z + 6 };
    const direction = { x: 0, y: 0, z: -1 };
    const hit = ctx.raycast({ direction, far: 40, origin, targets: [hitbox] });

    return {
      phase: enemy.phase,
      health: enemy.health,
      alive: enemy.alive,
      animCurrent: enemy.animation?.current,
      animFinished: enemy.animation?.finished,
      groupPos: enemy.group.position.toArray().map((n) => Number(n.toFixed(2))),
      hitboxWorld: [centre.x, centre.y, centre.z].map((n) => Number(n.toFixed(2))),
      hitboxInScene: hitbox.parent !== null,
      rayHit: hit === undefined ? null : Number(hit.distance.toFixed(2)),
      rayHitIsEnemy: hit?.object?.userData?.enemy !== undefined,
    };
  });
  console.log(`${label.padEnd(22)} ${JSON.stringify(out)}`);
  return out;
};

const kill = async () => {
  return await page.evaluate(() => {
    const ctx = window.__TN_GAME__.ctx;
    let hitbox;
    ctx.scene.traverse((object) => {
      if (hitbox === undefined && object.userData?.enemy !== undefined) hitbox = object;
    });
    const enemy = hitbox.userData.enemy;
    let earned = 0;
    for (let round = 0; round < 12 && enemy.alive; round += 1) earned += enemy.hurt(ctx, 10);
    return { earned, phase: enemy.phase, health: enemy.health };
  });
};

await observe("1 alive at boot");
console.log("kill ->", JSON.stringify(await kill()));
await observe("2 just killed");
await page.waitForTimeout(2000);
await observe("3 dead 2s");
await page.waitForTimeout(3200);
await observe("4 after respawn 5.2s");
console.log("second kill attempt ->", JSON.stringify(await kill()));
await observe("5 after second kill");

await browser.close();
