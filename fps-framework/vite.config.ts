import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { optimizeModels } from "create-threenative";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    // Regenerates public/assets/*.glb from assets/models/ at build time
    // whenever a source is newer (quantize + WebP + separate vertex layout).
    // Disable: optimizeModels({ disabled: true }) or TN_NO_OPTIMIZE_MODELS=1.
    optimizeModels(),
    react(),
    tailwindcss(),
  ],
  server: {
    watch: {
      // The playtest runner writes its artifacts inside the project, and the
      // polling watcher answers that with a full page reload — mid-scenario,
      // which the runner then reports as TN_PLAYTEST_PAGE_NAVIGATED.
      // `proof-artifacts` and `captures` are what `sweep:capture` writes, and they were
      // missing here: the reload detaches the canvas and the runner fails with
      // "Element is not attached to the DOM" rather than anything about the game.
      ignored: [
        "**/artifacts/**",
        "**/captures/**",
        "**/playtests/**",
        "**/proof-artifacts/**",
        "**/screenshots/**",
      ],
      usePolling: true,
    },
  },
});
