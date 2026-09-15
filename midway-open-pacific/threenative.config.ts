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
    // The scene-render projection measured as a net loss here (P1: paid reconcile, no frame-time
    // win, multi-second engagement freeze, and a darker mirror image). Decline it: no mirror, no
    // scan, the authored scene every frame.
    projection: false,
  },
  ui: { renderer: "web" },
};

export default config;
