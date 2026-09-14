#!/usr/bin/env bash
# Convert the unsupported legacy spec/gloss workflow; retain every source mesh and texture.
set -euo pipefail
cd "$(dirname "$0")/.."
STAGE="${MIDWAY_STAGE:-/tmp/midway-pt59-stage}"
mkdir -p "$STAGE"
pnpm exec gltf-transform metalrough "${1:-/home/joao/Downloads/us_elco_77_ft_pt-59_war_thunder.glb}" "$STAGE/pt59.glb" --vertex-layout separate
pnpm exec gltf-transform webp "$STAGE/pt59.glb" public/assets/boat.pt59.glb --quality 90 --vertex-layout separate
