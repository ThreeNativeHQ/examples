#!/usr/bin/env bash
# Rebuild from untouched downloads. Preserve proportions and UV boundaries; no Blender collapse.
#
# Shipped triangle budgets, matching the rest of the fleet:
#   aircraft.tbd-devastator      40,000
#   aircraft.tbd-devastator.ai   12,000
#   aircraft.b5n2-kate           12,000 (its supplied source is already below this)
set -euo pipefail
cd "$(dirname "$0")/.."
SOURCE="${MIDWAY_SOURCE_MODELS:-/home/joao/Downloads/midway-missing-models}/aircrafts"
STAGE="${MIDWAY_STAGE:-/tmp/midway-aircraft-stage}"
mkdir -p "$STAGE"
only="${1:-}"
pack() { pnpm exec gltf-transform webp "$1" "$2" --quality 90 --vertex-layout separate; }

# gltf-transform's weld merges only bitwise-identical vertices, and a Tripo mesh splits a vertex at
# every UV seam, so it welds nothing here. meshoptimizer's simplifier then sees a surface torn into
# UV patches, cannot collapse across a seam, and quits near 250k triangles however low the ratio or
# error go. Merge by distance in Blender first (the weld the old importer used), then simplify with
# gltf-transform so the budget is actually reached.
weld() {
  blender -b -t 6 --python-exit-code 1 --python-expr "
import bpy
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=r'''$1''')
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
bpy.ops.object.select_all(action='DESELECT')
for o in meshes: o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.remove_doubles(threshold=1e-4)
bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.export_scene.gltf(filepath=r'''$2''', export_format='GLB', export_yup=True)
print('WELD faces', sum(len(o.data.polygons) for o in meshes))
" | grep -E '^WELD' | sed "s|^|$3 |"
}

if [[ -z "$only" || "$only" == aircraft.tbd-devastator* ]]; then
  weld "$SOURCE/Douglas+TBD-1+Devastator.glb" "$STAGE/tbd.weld.glb" tbd
  # error .01 is required for the ratio to be reached; at error .001 the simplifier quits early.
  pnpm exec gltf-transform simplify "$STAGE/tbd.weld.glb" "$STAGE/tbd.simplified.glb" \
    --ratio .018 --error .01 --lock-border true --vertex-layout separate
  blender -b -t 6 --python-exit-code 1 -P tools/blender/align-aircraft.py -- "$STAGE/tbd.simplified.glb" "$STAGE/tbd.body.glb" --span 15.24
  blender -b -t 6 --python-exit-code 1 -P tools/blender/articulate-aircraft.py -- "$STAGE/tbd.body.glb" "$STAGE/tbd.rig.glb" tbd
  if [[ "$only" != aircraft.tbd-devastator.ai ]]; then pack "$STAGE/tbd.rig.glb" public/assets/aircraft.tbd-devastator.glb; fi
  if [[ "$only" != aircraft.tbd-devastator ]]; then
    pnpm exec gltf-transform simplify "$STAGE/tbd.rig.glb" "$STAGE/tbd.ai.glb" --ratio .25 --error .01 --lock-border true --vertex-layout separate
    pack "$STAGE/tbd.ai.glb" public/assets/aircraft.tbd-devastator.ai.glb
  fi
fi
if [[ -z "$only" || "$only" == aircraft.b5n2-kate ]]; then
  blender -b -t 6 --python-exit-code 1 -P tools/blender/align-aircraft.py -- "$SOURCE/Nakajima+B5N2+Kate+Torpedo+Bomber.glb" "$STAGE/kate.body.glb" --span 15.52
  blender -b -t 6 --python-exit-code 1 -P tools/blender/articulate-aircraft.py -- "$STAGE/kate.body.glb" "$STAGE/kate.rig.glb" kate
  pack "$STAGE/kate.rig.glb" public/assets/aircraft.b5n2-kate.glb
fi
