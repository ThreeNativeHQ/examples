#!/usr/bin/env bash
# Rebuild from untouched downloads. Preserve proportions and UV boundaries; no Blender collapse.
set -euo pipefail
cd "$(dirname "$0")/.."
SOURCE="${MIDWAY_SOURCE_MODELS:-/home/joao/Downloads/midway-missing-models}/aircrafts"
STAGE="${MIDWAY_STAGE:-/tmp/midway-aircraft-stage}"
mkdir -p "$STAGE"
only="${1:-}"
pack() { pnpm exec gltf-transform webp "$1" "$2" --quality 90 --vertex-layout separate; }
if [[ -z "$only" || "$only" == aircraft.tbd-devastator* ]]; then
  pnpm exec gltf-transform weld "$SOURCE/Douglas+TBD-1+Devastator.glb" "$STAGE/tbd.weld.glb" --vertex-layout separate
  pnpm exec gltf-transform simplify "$STAGE/tbd.weld.glb" "$STAGE/tbd.simplified.glb" \
    --ratio .03 --error .001 --lock-border true --vertex-layout separate
  blender -b -t 6 --python-exit-code 1 -P tools/blender/align-aircraft.py -- "$STAGE/tbd.simplified.glb" "$STAGE/tbd.body.glb" --span 15.24
  blender -b -t 6 --python-exit-code 1 -P tools/blender/articulate-aircraft.py -- "$STAGE/tbd.body.glb" "$STAGE/tbd.rig.glb" tbd
  if [[ "$only" != aircraft.tbd-devastator.ai ]]; then pack "$STAGE/tbd.rig.glb" public/assets/aircraft.tbd-devastator.glb; fi
  if [[ "$only" != aircraft.tbd-devastator ]]; then
    pnpm exec gltf-transform simplify "$STAGE/tbd.rig.glb" "$STAGE/tbd.ai.glb" --ratio .12 --error .001 --vertex-layout separate
    pack "$STAGE/tbd.ai.glb" public/assets/aircraft.tbd-devastator.ai.glb
  fi
fi
if [[ -z "$only" || "$only" == aircraft.b5n2-kate ]]; then
  blender -b -t 6 --python-exit-code 1 -P tools/blender/align-aircraft.py -- "$SOURCE/Nakajima+B5N2+Kate+Torpedo+Bomber.glb" "$STAGE/kate.body.glb" --span 15.52
  blender -b -t 6 --python-exit-code 1 -P tools/blender/articulate-aircraft.py -- "$STAGE/kate.body.glb" "$STAGE/kate.rig.glb" kate
  pack "$STAGE/kate.rig.glb" public/assets/aircraft.b5n2-kate.glb
fi
