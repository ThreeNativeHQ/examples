/**
 * Does pressing Space actually fire, in a real browser, on the real requestAnimationFrame loop?
 *
 * The sealed proof drives the game through the playtest bridge's `fixedStep`, which advances the
 * simulation directly. A human presses a key and waits for rAF. Those are two different code
 * paths, and a game can pass the first while being unplayable on the second — which is exactly
 * what a proof is supposed to catch and did not.
 *
 *   node real-input-probe.mjs <url> <label>
 */
import { chromium } from "playwright";

const url = process.argv[2];
const label = process.argv[3] ?? url;
if (!url) throw new Error("usage: real-input-probe.mjs <url> <label>");

const browser = await chromium.launch({
  headless: false,
  args: [
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan",
    "--disable-gpu-sandbox",
    "--ignore-gpu-blocklist",
    "--window-size=1280,800",
  ],
});

const consoleErrors = [];
const pageErrors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
  });
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200)));

  await page.goto(url, { waitUntil: "load", timeout: 60_000 });
  await page.waitForTimeout(9000);

  // Read whatever state the page exposes, without assuming which shape it uses.
  const readState = async () =>
    page.evaluate(() => {
      const b = window.__THREENATIVE_PLAYTEST_BRIDGE__;
      if (b?.sample === undefined) return { via: ["no-bridge"], state: null };
      try {
        const s = b.sample({ entities: [], resources: ["state"] });
        const res = s?.resources ?? s?.observations?.resources ?? null;
        const state = res?.state ?? res?.GameState ?? null;
        return { via: ["bridge.sample"], state: state ? JSON.parse(JSON.stringify(state)) : null,
                 resourceIds: res ? Object.keys(res) : [] };
      } catch (e) {
        return { via: ["sample-threw:" + String(e).slice(0, 80)], state: null };
      }
    });

  const before = await readState();

  // A real key press: focus the canvas the way a player does, then press.
  await page.mouse.move(640, 400);
  await page.keyboard.down("Space");
  await page.waitForTimeout(120);
  await page.keyboard.up("Space");
  await page.waitForTimeout(1200);
  const afterSpace = await readState();

  // Hold W for a second — movement on the real loop.
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(1000);
  await page.keyboard.up("KeyW");
  await page.waitForTimeout(400);
  const afterW = await readState();

  // A real click on the canvas: this is both "fire" (button 0) and the pointer-lock request.
  await page.mouse.click(640, 400);
  await page.waitForTimeout(1200);
  const afterClick = await readState();

  // The cursor question: does pointer lock actually engage, and is the cursor hidden if not?
  const pointer = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const style = canvas === null ? null : getComputedStyle(canvas);
    return {
      pointerLockEngaged: document.pointerLockElement !== null,
      lockedElement: document.pointerLockElement?.tagName ?? null,
      canvasCursor: style?.cursor ?? null,
      bodyCursor: getComputedStyle(document.body).cursor,
      canvasPresent: canvas !== null,
      pointerLockApi: typeof document.body.requestPointerLock === "function",
      contextMenuPrevented: (() => {
        const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
        const canvas = document.querySelector("canvas") ?? document.body;
        canvas.dispatchEvent(ev);
        return ev.defaultPrevented;
      })(),
    };
  });

  const pick = (s) => {
    if (!s?.state) return null;
    const k = ["shots", "ammo", "score", "targetsHit", "distanceMoved", "phase", "health"];
    return Object.fromEntries(k.filter((n) => n in s.state).map((n) => [n, s.state[n]]));
  };

  process.stdout.write(
    `${JSON.stringify(
      {
        label,
        via: before.via,
        before: pick(before),
        afterSpace: pick(afterSpace),
        afterW: pick(afterW),
        afterClick: pick(afterClick),
        pointer,
        consoleErrors: consoleErrors.slice(0, 6),
        pageErrors: pageErrors.slice(0, 6),
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await browser.close();
}
