// Runs tools/soundscape-proof.html against a real Chromium and reports what it measured.
//
//   node tools/soundscape-proof.mjs [--headless]
//
// Headed by default: this machine's headless Chromium is the one that hands back a silent or
// stalled audio graph, and a proof that cannot tell "no signal" from "no audio device" is not
// a proof. Serves on 5302.
import path from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";

const PORT = 5302;
const headless = process.argv.includes("--headless");
const root = path.resolve(import.meta.dirname, "..");

// `configFile: false` on purpose. The project's config installs the asset watcher, which
// re-encodes every KTX2 texture in the game on boot and holds the first request past any sane
// navigation timeout. This page needs none of that: the clips are already compiled into
// `public/`, which vite serves at `/`, and nothing here imports React or Tailwind.
const server = await createServer({
  configFile: false,
  root,
  server: { port: PORT, strictPort: true, host: "127.0.0.1" },
  logLevel: "warn",
});
await server.listen();
const base = `http://127.0.0.1:${PORT}`;
console.log(`proof: serving at ${base}`);

const browser = await chromium.launch({
  headless,
  args: [
    "--ozone-platform=x11",
    // Without this the context starts suspended and every cue sits in the bus queue; the page
    // also clicks, so this is belt and braces rather than the only path.
    "--autoplay-policy=no-user-gesture-required",
  ],
});

let proof;
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
  page.on("console", (message) => {
    const text = message.text();
    if (!text.startsWith("TN_SOUNDSCAPE_PROOF")) console.log(`  [${message.type()}] ${text}`);
  });
  page.on("pageerror", (error) => console.log(`  [pageerror] ${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 400) console.log(`  [http ${response.status()}] ${response.url()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) console.log(`  [http ${response.status()}] ${response.url()}`);
  });
  await page.goto(`${base}/tools/soundscape-proof.html`, { waitUntil: "load", timeout: 120_000 });
  // A real user gesture, which is what AudioBus's own pointerdown listener is waiting for.
  await page.mouse.click(320, 200);
  await page.waitForFunction(() => globalThis.__SOUNDSCAPE_PROOF__ !== undefined, undefined, {
    timeout: 60_000,
  });
  proof = await page.evaluate(() => globalThis.__SOUNDSCAPE_PROOF__);
} finally {
  await browser.close();
  await server.close();
}

console.log("\nDecoded clips (peak is of the actual samples the browser fetched):");
for (const clip of proof.buffers) {
  console.log(
    `  ${clip.name.padEnd(24)} ${clip.seconds.toFixed(2).padStart(5)}s @ ${String(clip.rate).padStart(5)} Hz  peak ${clip.peak.toFixed(4)}`,
  );
}
console.log("\nMeasured off the listener input:");
for (const phase of proof.phases) {
  console.log(`  ${phase.name.padEnd(18)} rms ${phase.rms.toExponential(3)}  peak ${phase.peak.toFixed(5)}`);
}
console.log(`\ncontext: ${proof.contextState}   footsteps fired while walking: ${proof.steps}`);
console.log(`debug(): ${JSON.stringify(proof.debug)}`);
if (proof.ok) {
  console.log("\nTN_SOUNDSCAPE_PROOF: PASS");
} else {
  console.log("\nTN_SOUNDSCAPE_PROOF: FAIL");
  for (const failure of proof.failures) console.log(`  - ${failure}`);
}
process.exitCode = proof.ok ? 0 : 1;
