import type { IThreeNativeConfig } from "@threenative/core";

export default {
  app: {
    id: "com.threenative.lumenhall",
    name: "lumen-hall",
    version: "1.0.0",
    build: 1,
    icon: "public/icon.png",
    icons: { web: { favicon: "public/favicon.svg" } },
  },
  display: {
    orientation: "landscape", // Mobile viewport orientation.
    fullscreen: true, // Keep the game surface edge to edge.
    keepScreenOn: true, // Do not dim during a play session.
    maxFps: 60, // Set 120 to opt into a supported high-refresh display mode.
  },
  window: {
    title: "lumen-hall", // Desktop window title.
    width: 1280,
    height: 720,
    resizable: true,
  },
  bootSplash: {
    backgroundColor: "#0d1b2a",
  },
  nativeEntry: "src/game.ts",
  renderer: {
    preferWebGPU: true, // Use WebGPU when the host exposes it.
    // The engine holds the `display.maxFps` budget by scaling the 3D drawing buffer, and reports
    // the scale it settled on in every `TN_FRAME_BUDGET` window. Replace with a number in (0, 1]
    // to pin it — the loop stops and the reporting does not. CSS, UI and camera framing never move.
    resolutionScale: "auto",
    // Measured on this scene at 1600x900: 4x MSAA costs 19.92 ms of GPU against 8.87 ms
    // without it — 55% of the whole frame. The beauty pass is a four-attachment rgba16float
    // MRT (colour, normal, metalness, roughness) because the screen-space stages need those
    // buffers, and every attachment pays the multisample cost. The post chain then resolves
    // and works in screen space anyway, so most of what MSAA bought is thrown away.
    //
    // Turn this back on for a build with no post chain, where it is nearly free by comparison.
    antialias: false,
  },
  assets: {
    // Mobile has no WebAssembly, so neither Basis-decoded textures nor Meshopt-decoded geometry
    // can ship there — and these demo assets are tiny enough that compression only ever grew
    // them. Ship exactly what is committed.
    models: "none",
    textures: "none",
  },
  // One UI on every target: src/ui/ renders through the platform's own browser-class renderer,
  // so the same React, Tailwind, CSS and SVG run on web, desktop, Android and iOS alike.
  // Switch to "native" for a UI drawn as part of the rendered frame, with no web view and no
  // extra process — and own the appearance difference that comes with it.
  ui: { renderer: "web" },
} satisfies IThreeNativeConfig;
