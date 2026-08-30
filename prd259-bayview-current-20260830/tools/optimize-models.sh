#!/usr/bin/env bash
# Regenerate the runtime copies in public/assets/*.glb from the source models
# in assets/models/. `vite build` runs this pipeline automatically (see the
# optimize-models plugin in vite.config.ts), so you only need this script to
# force a regeneration without a full build. The source GLBs stay untouched
# (they are third-party material kept out of history by the root .gitignore);
# everything a build or a dev server actually loads is the optimized output
# this writes over.
#
# Why not Draco/meshopt: both need a decoder wired into GLTFLoader at runtime,
# and ctx.assets is framework-owned. This pipeline sticks to extensions three's
# GLTFLoader decodes natively:
#   - KHR_mesh_quantization  — positions/normals as i16 instead of f32
#   - EXT_texture_webp       — browser-decoded; enemy already shipped webp
# plus lossless keyframe resampling and a 2048px texture cap.
#
# --vertex-layout separate is NOT optional: gltf-transform defaults to
# interleaved buffers and THREE.WebGPURenderer cannot build a render pipeline
# from them — every mesh fails with "Failed to read the 'attributes' property
# from 'GPUVertexState'". Separate layout costs ~0 bytes here and renders.
#
# Graph-altering passes stay OFF (--join/--flatten/--instance/--palette/
# --simplify): Enemy.ts resolves bones by name (mixamorigRightHand, Grip_Bone)
# and headshot gates raycast against these exact meshes.
#
# Measured 2026-08-22, from assets/models sources:
# weapon-ak47 11.75→1.44 MB, player-viewmodel 7.5→1.45 MB,
# enemy-terrorist 3.76→1.59 MB (public/ 30→16 MB overall).
# Vertex counts and every clip name unchanged; verified visually and by
# headshot-hits-head + shot-tracks-crosshair after swapping in.
set -euo pipefail
cd "$(dirname "$0")/.."

for name in weapon-ak47 player-viewmodel enemy-terrorist; do
  src="assets/models/$name.glb"
  dst="public/assets/$name.glb"
  [ -f "$src" ] || { echo "missing $src" >&2; exit 1; }
  npx --yes @gltf-transform/cli optimize "$src" "$dst" \
    --compress quantize \
    --simplify false --join false --flatten false --instance false --palette false \
    --texture-compress webp --texture-size 2048 \
    --vertex-layout separate
done
