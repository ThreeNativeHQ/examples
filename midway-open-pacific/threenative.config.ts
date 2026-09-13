import type { IThreeNativeConfig } from "@threenative/core";

const config: IThreeNativeConfig = {
  app: {
    id: "com.threenative.midwayopenpacific",
    name: "midway-open-pacific",
    version: "1.0.0",
    build: 1,
    icon: "public/icon.png",
    icons: { web: { favicon: "public/favicon.svg" } },
  },
  display: {
    orientation: "landscape",
    fullscreen: true,
    keepScreenOn: true,
    maxFps: 60,
  },
  window: {
    title: "MIDWAY — Open Pacific",
    width: 1280,
    height: 720,
    resizable: true,
  },
  bootSplash: { backgroundColor: "#102a37" },
  nativeEntry: "src/game.ts",
  renderer: {
    // WebGPU by default; the ocean, sky and combat particles are TSL node materials so the same
    // source runs on the WebGPU backend on web and native.
    resolutionScale: "auto",
    alphaAntialiasing: true,
  },
  // The game's UI is the DOM in index.html, which src/ui/dom.ts drives on the web only. There is
  // no src/ui/main.tsx web view to composite, so native targets draw the game and nothing else.
  ui: { renderer: "native" },
};

export default config;
