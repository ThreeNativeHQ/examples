import type { IThreeNativeConfig } from "@threenative/core";

export default {
  app: {
    id: "com.threenative.bayview",
    name: "Bayview",
    version: "1.0.0",
    build: 1,
    icon: "public/icon.png",
  },
  display: {
    orientation: "landscape", // Mobile viewport orientation.
    fullscreen: true, // Keep the game surface edge to edge.
    keepScreenOn: true, // Do not dim during a play session.
  },
  window: {
    title: "Bayview — 5v5 Bomb Defusal", // Desktop window title.
    width: 1280,
    height: 720,
    resizable: true,
  },
  nativeEntry: "src/game.ts",
  renderer: { preferWebGPU: true }, // Use WebGPU when the host exposes it.
} satisfies IThreeNativeConfig;
