#!/usr/bin/env bash
# Regenerate the runtime copies in public/assets/*.glb from the source models
# in assets/models/. The source GLBs stay untouched (they are third-party
# material kept out of history by the root .gitignore); everything a build or
# a dev server actually loads is the optimized output this writes over.
#
# Why not Draco/meshopt: both need a decoder wired into GLTFLoader at runtime,
# and ctx.assets is framework-owned. This pipeline sticks to extensions three's
# GLTFLoader decodes natively:
#   - KHR_mesh_quantization  — positions/normals as i16 instead of f32
#   - EXT_texture_webp       — browser-decoded; enemy already shipped webp
# plus lossless keyframe resampling and a 2048px texture cap.
#
# Graph-altering passes stay OFF (--join/--flatten/--instance/--palette/
# --simplify): Enemy.ts resolves bones by name (mixamorigRightHand, Grip_Bone)
# and headshot gates raycast against these exact meshes.
#
# Measured 2026-08-22: weapon-ak47 9.74→1.46 MB, player-viewmodel 5.66→1.45 MB,
# enemy-terrorist 3.76→1.59 MB. Vertex counts and every clip name unchanged;
# verified visually + by playtest after swapping in.
set -euo pipefail
cd "$(dirname "$0")/.."

for name in weapon-ak47 player-viewmodel enemy-terrorist; do
  src="assets/models/$name.glb"
  dst="public/assets/$name.glb"
  [ -f "$src" ] || { echo "missing $src" >&2; exit 1; }
  npx --yes @gltf-transform/cli optimize "$src" "$dst" \
    --compress quantize \
    --simplify false --join false --flatten false --instance false --palette false \
    --texture-compress webp --texture-size 2048
done
