import type { IncomingMessage, ServerResponse } from "node:http";
import { cp, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { createEngineFreshnessPlugin, createWebBrandPlugin } from "create-threenative";
import { defineConfig } from "vite";
import type { Plugin } from "vite";

/**
 * Serves the prepared specimen from `content/`.
 *
 * `content/` is gitignored — the specimen is Fab Standard License, local use only — so it is
 * deliberately not in `assets/`, and this project ships no asset pipeline at all: with no
 * `assets/` there is no `assets.manifest.json`, and the loader takes its documented no-manifest
 * route, which resolves the verbatim path this plugin serves.
 */
function specimenContentPlugin(): Plugin {
  const directory = "content";
  // Matches `/content/...` anywhere in the path, not only at the root: the asset loader's second
  // candidate is `assets/content/...`, and vite's SPA fallback would answer that one with
  // index.html — a 200 the loader would happily read as the file it asked for.
  const serve = (root: string) => async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const request = (req.url ?? "").split("?")[0] ?? "";
    const at = request.indexOf("/content/");
    if (at < 0) return next();
    const rest = request.slice(at + "/content/".length);
    if (rest === "" || rest.endsWith("/") || rest.includes("..")) return next();
    try {
      const body = await readFile(join(root, rest));
      res.setHeader("Content-Type", rest.endsWith(".glb") ? "model/gltf-binary" : "application/octet-stream");
      res.end(body);
    } catch {
      // A real 404, not `next()`: the SPA fallback would answer with index.html and the loader
      // would report a JSON parse failure instead of the file that is not there.
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain");
      res.end(`not prepared: ${rest} — run \`node tools/prepare.mjs\`\n`);
    }
  };
  return {
    name: "metahuman-specimen-content",
    configureServer(server) {
      server.middlewares.use(serve(resolve(server.config.root, directory)));
    },
    async closeBundle() {
      const from = resolve(process.cwd(), directory);
      const to = resolve(process.cwd(), "dist", directory);
      await cp(from, to, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

export default defineConfig({
  plugins: [
    createEngineFreshnessPlugin(),
    createWebBrandPlugin(),
    react(),
    tailwindcss(),
    specimenContentPlugin(),
  ],
  server: {
    watch: {
      ignored: ["**/artifacts/**", "**/screenshots/**", "**/playtests/**"],
      usePolling: true,
    },
  },
});
