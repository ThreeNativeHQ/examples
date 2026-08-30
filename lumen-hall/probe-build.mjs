import { build } from "esbuild";
import { readFileSync } from "node:fs";
// cathedral.ts imports "./lighting.js" for a file that is lighting.ts — vite rewrites that,
// esbuild does not, so map the extension back on resolve.
const tsExt = {
  name: "ts-ext",
  setup(b) {
    b.onResolve({ filter: /^\.\/.*\.js$/ }, (args) => ({
      path: new URL(args.path.replace(/\.js$/, ".ts"), `file://${args.resolveDir}/`).pathname,
    }));
  },
};
await build({
  bundle: true,
  entryPoints: ["probe-entry.ts"],
  external: ["three", "three/addons/*"],
  format: "esm",
  outfile: "probe-bundle.mjs",
  plugins: [tsExt],
});
