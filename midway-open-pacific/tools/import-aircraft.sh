#!/usr/bin/env bash
# Imports the supplied TBD and Kate: principal-span alignment, nose to glTF -Z, wheels on y = 0,
# published dimensions, propeller cut into its own pivoted child, then meshoptimizer simplification
# to the detail budget. Blender's collapse decimator shatters these photogrammetry-style surfaces;
# weld + simplify keeps the skin intact at the same triangle count.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC_DIR="${MIDWAY_SOURCE_MODELS:-/home/joao/Downloads/midway-missing-models}/aircrafts"
STAGE="${MIDWAY_STAGE:-/tmp/midway-fleet-stage}"
PREVIEW="$STAGE/preview"
mkdir -p "$STAGE" "$PREVIEW"
only="${1:-}"

# id | source | span | length | height | source triangles | budget
while IFS='|' read -r id src span length height srctri budget; do
  if [ -n "$only" ] && [ "$only" != "$id" ]; then continue; fi
  echo "### $id"
  raw="$STAGE/$id.aligned.glb"
  blender -b -P tools/blender/align-aircraft.py -- "$SRC_DIR/$src" "$raw" \
    --span "$span" --length "$length" --height "$height" --decimate "$budget" 2>/dev/null \
    | grep -E "^(AIRCRAFT|REPAIR|SCALED|WELD|DECIMATE|REDROP|PROP|PART|WROTE)" | sed "s|^|$id |"
  pnpm exec gltf-transform webp "$raw" "public/assets/$id.glb" \
    --quality 90 --vertex-layout separate >/dev/null 2>&1
  echo "$id -> $(node tools/inspect-glb.mjs "public/assets/$id.glb" | grep -oE 'triangles=[0-9]+') $(stat -c%s "public/assets/$id.glb") bytes"
done <<'ROWS'
aircraft.tbd-devastator|Douglas+TBD-1+Devastator.glb|15.24|10.67|4.60|1915063|40000
aircraft.tbd-devastator.ai|Douglas+TBD-1+Devastator.glb|15.24|10.67|4.60|1915063|12000
aircraft.b5n2-kate|Nakajima+B5N2+Kate+Torpedo+Bomber.glb|15.52|10.30|3.70|9793|12000
ROWS
