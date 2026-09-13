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
    // The ported ocean, sky and combat-particle shaders are authored as GLSL, so this game
    // selects the WebGL2 backend core provides instead of the WebGPU/TSL default. Rewriting
    // them as TSL is the work web-only status asks for; until then this is an honest web lane.
    preferWebGPU: false,
    resolutionScale: "auto",
    alphaAntialiasing: true,
  },
  ui: { renderer: "web" },
};

export default config;
