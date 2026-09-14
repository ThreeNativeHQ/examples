#!/usr/bin/env bash
# Reuse the existing UAL library with measured anatomy; downloads stay untouched.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${UAL1:?Set UAL1 to UAL1_Standard.glb}" "${UAL2:?Set UAL2 to UAL2_Standard.glb}"
SOURCE="${MIDWAY_SOURCE_MODELS:-/home/joao/Downloads/midway-missing-models}"
STAGE="${MIDWAY_STAGE:-/tmp/midway-people-stage}"
mkdir -p "$STAGE"
while IFS='|' read -r id anatomy source; do
 blender -b -t 6 --python-exit-code 1 -P tools/blender/rig_humanoid.py -- "$UAL1" "$UAL2" "$source" "tools/blender/$anatomy.json" "$STAGE/$id.glb"
 pnpm exec gltf-transform webp "$STAGE/$id.glb" "public/assets/$id.glb" --quality 90 --vertex-layout separate
done <<ROWS
carrier-aircraft-pilot|pilot|$SOURCE/carrier-aircraft-pilot.glb
flight-deck-director|flight-deck-director|$SOURCE/flight-deck-director.glb
deck-crew|navy-sailor-light|${MIDWAY_SAILOR_SOURCE:-/home/joao/Downloads/navy sailor 3d.glb}
ROWS
