import type { IThreeNativeConfig } from "@threenative/core";

export default {
  app: {
    id: "com.threenative.cratefall",
    name: "cratefall",
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
    title: "cratefall", // Desktop window title.
    width: 1280,
    height: 720,
    resizable: true,
  },
  // `loading` was this key's old name and its old shape; the loading screen it configured lives in
  // src/render/ now, and the framework keeps only the colour it paints before any of that runs.
  bootSplash: {
    backgroundColor: "#0d1b2a",
  },
  // One UI on every target: src/ui/ renders through the platform's own browser-class renderer,
  // so the same React, Tailwind, CSS and SVG run on web, desktop, Android and iOS alike.
  ui: { renderer: "web" },
  nativeEntry: "src/game.ts",
  renderer: { preferWebGPU: true }, // Use WebGPU when the host exposes it.
} satisfies IThreeNativeConfig;
