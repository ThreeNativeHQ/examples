#!/usr/bin/env bash
# Imports every supplied hull named in tools/blender/fleet.json: principal-axis alignment, bow to
# glTF -Z, uniform scale to reference length, error-bounded simplification, WebP export into
# public/assets/. Re-runnable; the originals in Downloads are never written.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC_DIR="${MIDWAY_SOURCE_MODELS:-/home/joao/Downloads/midway-missing-models}"
STAGE="${MIDWAY_STAGE:-/tmp/midway-fleet-stage}"
PREVIEW="${MIDWAY_PREVIEW:-$STAGE/preview}"
mkdir -p "$STAGE" "$PREVIEW"
only="${1:-}"

node -e '
const f = require("./tools/blender/fleet.json");
for (const s of f.ships) console.log([s.id, s.src, s.length, s.beam, s.height, s.draught, s.flip, s.budget, s.derivedFrom ?? ""].join("\t"));
' | while IFS=$'\t' read -r id src length beam height draught flip budget derived; do
  if [ -n "$only" ] && [ "$only" != "$id" ]; then continue; fi
  if [ -n "$derived" ]; then
    # Derived, not supplied. derive-mogami.py moves vertices on the already-aligned donor hull; it
    # applies no scale of any kind, so the uniform-scale guarantee is untouched.
    echo "### $id (derived from $derived)"
    blender -b -t 6 --python-exit-code 1 -P tools/blender/derive-mogami.py -- \
      "$STAGE/$derived.raw.glb" "$STAGE/$id.raw.glb" \
      | grep -E "^(DECK|TURRETS|DERIVED|WROTE)" | sed "s|^|$id |"
    pnpm exec gltf-transform webp "$STAGE/$id.raw.glb" "public/assets/$id.glb" \
      --quality 90 --vertex-layout separate >/dev/null 2>&1
    echo "$id packed -> public/assets/$id.glb ($(stat -c%s "public/assets/$id.glb") bytes)"
    continue
  fi
  source="$SRC_DIR/$src"
  if [ "$id" = "carrier.yorktown" ]; then
    pnpm exec gltf-transform weld "$source" "$STAGE/$id.weld.glb" --vertex-layout separate
    pnpm exec gltf-transform simplify "$STAGE/$id.weld.glb" "$STAGE/$id.simplified.glb" \
      --ratio .11 --error .0001 --lock-border true --vertex-layout separate
    source="$STAGE/$id.simplified.glb"
  fi
  args=(--length "$length" --draught "$draught"
        --preview "$PREVIEW/$id")
  [ "$flip" = "true" ] && args+=(--flip)
  echo "### $id"
  blender -b -t 6 --python-exit-code 1 -P tools/blender/align-ship.py -- "$source" "$STAGE/$id.raw.glb" "${args[@]}" \
    | grep -E "^(WATERLINE|ALIGN|PROPORTIONS|DECIMATE|FINAL|WROTE)" | sed "s|^|$id |"
  pnpm exec gltf-transform webp "$STAGE/$id.raw.glb" "public/assets/$id.glb" \
    --quality 90 --vertex-layout separate >/dev/null 2>&1
  echo "$id packed -> public/assets/$id.glb ($(stat -c%s "public/assets/$id.glb") bytes)"
done
