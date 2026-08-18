# Cross-platform probe — the fox game on web, desktop and Android

**The record of this probe lives in the framework repository**, because that is where the
fixes and the follow-up work landed:

- `~/projects/threejs-webgpu/docs/verification/probe-real-game-cross-platform-2026-08-09.md`
  — what executed on each platform, both defects found, and what is still not claimed.
- `docs/PRDs/PRD-053-core-input-multitouch.md` — multi-touch input, and the removal of the
  core line-count cap.
- `docs/PRDs/PRD-054-write-once-run-anywhere.md` — the parity gate that would have caught
  these defects, emulator-first for mobile.
- `docs/PRDs/PRD-055-native-hud-reopened.md` — the 330 lines of HUD and controls this game
  had to hand-author, and whether that should stay true.

Fixed and committed as `0d0495c`: wgpu-native pinned to v25.0.2.2 (the Android abort), and
WebGPU device errors routed to logcat (the silence around it).

## This project

`~/projects/fox-game` copied into a `create-threenative --template minimal` scaffold and
built for all three targets. The original was never modified. About 1,600 of its 1,950 lines
— level, props, entities, fox rig, palette — run unchanged on every platform.

Three things were written for this port, all in this project, none of them native-specific
branches:

- `src/fox/sky.js` — the GLSL `ShaderMaterial` sky rebaked as vertex colours, because raw
  GLSL renders under `WebGLRenderer` and produces nothing under `WebGPURenderer`, on web as
  much as on native.
- `src/render/hud.ts` — the HUD and touch controls as Three.js geometry parented to the
  camera, because the framework ships no native HUD (PRD-051, reopened by PRD-055).
- `src/scenes/Play.ts` — the original `requestAnimationFrame` loop rewritten as a scene frame
  function reading `ctx.input`.

## Run it

```sh
pnpm install
npx threenative build --target web && npx vite            # web

THREENATIVE_RUNTIME_BINARY=~/projects/threejs-webgpu/packages/runtime-native/build/tn-linux/mystral \
  npx threenative build --target desktop
SDL_VIDEODRIVER=x11 xvfb-run -a -s '-screen 0 1600x900x24' \
  ./dist-native/fox-native --screenshot shot.png --frames 300

./android-play.sh <label> [seconds]                       # emulator on adb; see the script
```

`android-play.sh` patches the built bundle into the debug APK and re-signs it, bypassing
Gradle on purpose: `packages/runtime-native/android` regenerates its own JS asset from
`examples/native-smoke`, so a Gradle build will silently ship the smoke example instead of
this game.

Screenshots from the run are in `artifacts/probe/`. The current set: `22-web-hud.jpg`,
`21-desktop-hud.png`, `18-android-final.png`, `20-android-after-touch.png`.
