import type { IThreeNativeConfig } from "@threenative/core";

// Rewritten together with src/render/prd259-upscaling.ts before each isolated arm build.
const PRD259_OUTPUT_SCALE = 1;

export default {
  assets: {
    models: "none",
    textures: "none",
  },
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
    maxFps: 240, // Industry-default mobile target; use 120 only for an explicit performance mode.
  },
  window: {
    title: "Bayview — 5v5 Bomb Defusal", // Desktop window title.
    width: 1280,
    height: 720,
    resizable: true,
  },
  nativeEntry: "src/game.ts",
  renderer: {
    preferWebGPU: true, // Use WebGPU when the host exposes it.
    resolutionScale: PRD259_OUTPUT_SCALE,
    // Preserve CSS/UI dimensions; only Android's 3D drawing buffer is scaled for frame budget.
    // Control presents a genuinely smaller drawing buffer. Temporal arms keep a full-size output
    // buffer and lower only their scene pass to the same source scale.
    android: { resolutionScale: PRD259_OUTPUT_SCALE },
  },
  // One UI on every target: src/ui/ renders through the platform's own browser-class renderer,
  // so the same React, Tailwind, CSS and SVG run on web, desktop, Android and iOS alike.
  ui: { renderer: "web" },
} satisfies IThreeNativeConfig;
