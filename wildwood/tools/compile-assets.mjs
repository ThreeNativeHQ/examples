/**
 * One-shot asset compile, exactly what `threenative build` and the dev watcher run, without a
 * Vite build or a server in the loop: `node tools/compile-assets.mjs`.
 *
 * The config is TypeScript, so it is bundled to a temporary module first (esbuild is a dev
 * dependency already); `@threenative/*` stays external so the installed packages resolve.
 */
import { compileAssets } from "@threenative/assets";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";

await mkdir("artifacts", { recursive: true });
await build({
  bundle: true,
  entryPoints: ["threenative.config.ts"],
  external: ["@threenative/*"],
  format: "esm",
  outfile: "artifacts/threenative.config.mjs",
  platform: "node",
});
const { default: config } = await import(pathToFileURL("artifacts/threenative.config.mjs").href);
const started = Date.now();
const result = await compileAssets({ config: config.assets, cwd: process.cwd() });
console.log(
  `TN_ASSETS_COMPILED written=${String(result.written)} skipped=${String(result.skipped)} in ${String(Math.round((Date.now() - started) / 1000))}s`,
);
