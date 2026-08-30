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
    // This comment used to say the demo assets were "tiny enough that compression only ever
    // grew them", and that was true when the heaviest model in the project was a 624-byte
    // proof triangle. It stopped being true the moment five authored glTF props arrived: the
    // candelabra alone carry three 2048x2048 textures each, which is 67 MB of VRAM per prop
    // once the GPU decodes them, and 320 MB across the five.
    //
    // Measured on this project's own assets, so these numbers are not borrowed:
    //   candela.glb  10.74 MiB -> 2.30 MiB on disk, 64.00 MiB -> 2.67 MiB on the GPU
    //   vigil.glb     8.02 MiB -> 1.76 MiB on disk, 64.00 MiB -> 2.67 MiB on the GPU
    //
    // maxSize 1024 rather than the pipeline's 2048 default: these are candlesticks seen at
    // three metres in a dark building, not hero assets, and 1024 is a 24x GPU reduction
    // against 6x. Nothing in the frame resolves the difference.
    //
    // simplify 0.25 is measured, not guessed. Rendering the real geometry at the real
    // condition — prop scaled to 3 m, camera 3 m from its centre, 1920x1080, twelve
    // azimuths — the silhouette moves at most 1 px across 99% of its outline at this ratio,
    // and candela drops 99,482 triangles to 24,870. At 0.15 the wicks and the tracery
    // openings start disappearing outright, at 16-21 px. So 0.25 is the floor, not a
    // preference.
    //
    // The cost this buys back: the four authored stands were 284,772 triangles, and they
    // cast shadows, so roughly that again in the shadow pass.
    //
    // WHAT THIS BREAKS: mobile native. Android QuickJS and iOS JSC have no WebAssembly, so
    // neither the Basis transcoder nor the Meshopt decoder can run there. An Android or iOS
    // build of this project needs `models: "none"`. That was already true before this change
    // — meshopt has been on by default and trips TN_NATIVE_MESH_COMPRESSION_UNSUPPORTED — so
    // this is not a new class of breakage, but it is worth naming rather than discovering.
    models: {
      textures: { maxSize: 1024 },
      simplify: { ratio: 0.25 },
    },
    // Left alone deliberately: the stone albedo and relief maps are under active revision in
    // src/render/surfaces.ts, and changing how they compile while they are being measured
    // would put a second variable into somebody else's before/after.
    textures: "none",
  },
  // One UI on every target: src/ui/ renders through the platform's own browser-class renderer,
  // so the same React, Tailwind, CSS and SVG run on web, desktop, Android and iOS alike.
  // Switch to "native" for a UI drawn as part of the rendered frame, with no web view and no
  // extra process — and own the appearance difference that comes with it.
  ui: { renderer: "web" },
} satisfies IThreeNativeConfig;
