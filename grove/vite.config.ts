import { watchAssets } from "@threenative/assets";
import { createEngineFreshnessPlugin, createWebBrandPlugin } from "create-threenative";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import type { Plugin } from "vite";
import config from "./threenative.config.js";

/**
 * Recompiles assets/ into public/ while the dev server runs, so editing a texture does not
 * need a rebuild. Serve-only by declaration: builds compile through `threenative build`.
 */
function assetsWatchPlugin(): Plugin {
  return {
    name: "threenative-assets-watch",
    apply: "serve",
    configureServer(server) {
      const handle = watchAssets({ config: config.assets, cwd: server.config.root });
      server.httpServer?.once("close", () => handle.close());
    },
  };
}

export default defineConfig({
  plugins: [createEngineFreshnessPlugin(), createWebBrandPlugin(), assetsWatchPlugin()],
  resolve: {
    alias: {
      // The pinned EZ Tree revision is unbuilt JavaScript whose `exports` map publishes only the
      // prebuilt browser bundle that eagerly loads textures. Point straight at the source entry
      // so the donor stays offline; `src/vegetation/ez-tree.d.ts` declares what it exports.
      "ez-tree-source/lib": fileURLToPath(
        new URL("node_modules/ez-tree-source/src/lib/index.js", import.meta.url),
      ),
    },
  },
  server: {
    watch: {
      ignored: ["**/artifacts/**", "**/screenshots/**", "**/playtests/**"],
      usePolling: true,
    },
  },
});
