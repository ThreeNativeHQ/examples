#!/usr/bin/env bash
# Imports every supplied hull named in tools/blender/fleet.json: principal-axis alignment, bow to
# glTF -Z, waterline fit to the class reference, decimation to budget, WebP export into
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
  if [ "$derived" = "cruiser.tone" ]; then
    # Mogami is not a supplied model: it is derived from the Tone hull that was just imported.
    blender -b -P tools/blender/derive-mogami.py -- "$STAGE/cruiser.tone.raw.glb" "$STAGE/$id.raw.glb" \
      2>/dev/null | grep -E "^(DECK|TURRETS|DERIVED|WROTE)" | sed "s|^|$id |"
    pnpm exec gltf-transform webp "$STAGE/$id.raw.glb" "public/assets/$id.glb" \
      --quality 90 --vertex-layout separate >/dev/null 2>&1
    echo "$id packed -> public/assets/$id.glb ($(stat -c%s "public/assets/$id.glb") bytes)"
    continue
  fi
  args=(--length "$length" --beam "$beam" --height "$height" --draught "$draught"
        --decimate "$budget" --preview "$PREVIEW/$id")
  [ "$flip" = "true" ] && args+=(--flip)
  echo "### $id"
  blender -b -P tools/blender/align-ship.py -- "$SRC_DIR/$src" "$STAGE/$id.raw.glb" "${args[@]}" 2>/dev/null \
    | grep -E "^(WATERLINE|ALIGN|REPAIR|DECIMATE|FINAL|WROTE)" | sed "s|^|$id |"
  pnpm exec gltf-transform webp "$STAGE/$id.raw.glb" "public/assets/$id.glb" \
    --quality 90 --vertex-layout separate >/dev/null 2>&1
  echo "$id packed -> public/assets/$id.glb ($(stat -c%s "public/assets/$id.glb") bytes)"
done
