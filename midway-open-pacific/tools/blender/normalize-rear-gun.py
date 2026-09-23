"""Normalise the supplied twin rear gun into the game's gun contract (source is READ ONLY).

Usage:
  blender -b -P tools/blender/normalize-rear-gun.py -- <source.glb> <out.glb> [evidence.json]

Contract, measured once by a two-plane fit of the two clean barrel cylinders in the supplied model
and then frozen here as constants — there is no direction search or clustering at run time, and the
fit is checked against the imported vertices (fail-closed):

  muzzle          -> glTF +Z (Blender -Y)
  cradle hinge    -> the origin
  one uniform scale so the source axial length is 1.000 m
  the barrel pair levelled (the pair itself defines the right vector)

Nothing is decimated, split or welded. The output is the same geometry the source shipped.
"""
import json
import sys

import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
if len(argv) < 2:
    raise SystemExit("usage: normalize-rear-gun.py -- <source.glb> <out.glb> [evidence.json]")
SRC, OUT = argv[0], argv[1]
EV = argv[2] if len(argv) > 2 else None

MOUTH = {
    "A": Vector((-0.483649, 0.405313, 0.129647)),
    "B": Vector((-0.419800, 0.360277, 0.291130)),
}
AXIS_G = Vector((-0.948235, -0.049680, 0.313659)).normalized()
HINGE_G = Vector((-0.006054, 0.406145, 0.062969))
TAG = "drg_gun_normalize"

g2b = lambda p: Vector((p.x, -p.z, p.y))       # glTF -> Blender import frame
b2g = lambda p: [round(p.x, 6), round(p.z, 6), round(-p.y, 6)]

for o in [o for o in bpy.data.objects if o.get(TAG)]:
    bpy.data.objects.remove(o, do_unlink=True)
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=SRC)
new = [o for o in bpy.data.objects if o not in before]
meshes = [o for o in new if o.type == "MESH"]
if not meshes:
    raise RuntimeError("import produced no mesh")
for o in meshes:
    o[TAG] = True
    mw = o.matrix_world.copy()
    o.parent = None
    o.matrix_world = mw
for o in [o for o in new if o.type != "MESH"]:
    bpy.data.objects.remove(o, do_unlink=True)

P = [o.matrix_world @ v.co for o in meshes for v in o.data.vertices]
for nm, g in MOUTH.items():
    d = min((v - g2b(g)).length for v in P)
    if d > 0.025:
        raise RuntimeError("muzzle %s landmark not found (nearest vertex %.4f)" % (nm, d))
h = g2b(HINGE_G)
if not all(min(p[i] for p in P) <= h[i] <= max(p[i] for p in P) for i in range(3)):
    raise RuntimeError("hinge landmark outside source bounds")

axis_b = g2b(AXIS_G)                           # muzzle-ward, Blender frame
hinge_b = g2b(HINGE_G)
# Level the barrel pair as well as the bore direction; preserve the source shape.
right_b = g2b(MOUTH["B"] - MOUTH["A"])
right_b = (right_b - axis_b * right_b.dot(axis_b)).normalized()
up_b = axis_b.cross(right_b).normalized()
R = Matrix((right_b, -axis_b, up_b))
length = max(p @ axis_b for p in P) - min(p @ axis_b for p in P)
s = 1.0 / length
M = Matrix.Scale(s, 4) @ R.to_4x4() @ Matrix.Translation(-hinge_b)
for o in meshes:
    o.matrix_world = M @ o.matrix_world

bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
try:
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
except Exception as exc:
    print("[drg] transform_apply fallback:", exc)
    for o in meshes:
        o.data.transform(o.matrix_world.copy())
        o.matrix_world = Matrix.Identity(4)
bpy.context.view_layer.update()

Q = [o.matrix_world @ v.co for o in meshes for v in o.data.vertices]
G = [(p.x, p.z, -p.y) for p in Q]               # actual transformed extrema in glTF
def outgltf(g):
    return b2g(s * (R @ (g2b(g) - hinge_b)))
ev = {
    "source": SRC,
    "output": OUT,
    "blender": bpy.app.version_string,
    "muzzle_mouths_source_gltf": {k: [round(v, 6) for v in m] for k, m in MOUTH.items()},
    "muzzle_mouths_output_gltf": {k: outgltf(m) for k, m in MOUTH.items()},
    "barrel_axis_source_gltf": [round(v, 6) for v in AXIS_G],
    "hinge_source_gltf": [round(v, 6) for v in HINGE_G],
    "hinge_output_gltf": [0.0, 0.0, 0.0],
    "uniform_scale": round(s, 8),
    "axis_length_source_m": round(length, 6),
    "axis_length_output_m": round(length * s, 6),
    "bounds_output_gltf": {
        "min": [round(min(p[i] for p in G), 6) for i in range(3)],
        "max": [round(max(p[i] for p in G), 6) for i in range(3)],
    },
    "triangles": sum(len(f.vertices) - 2 for o in meshes for f in o.data.polygons),
    "vertices": sum(len(o.data.vertices) for o in meshes),
    "objects": len(meshes),
}
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True,
                          export_apply=False, export_yup=True,
                          export_image_format="AUTO", export_animations=False)
if EV:
    open(EV, "w").write(json.dumps(ev, indent=2))
print("\nTN_BLENDER_RESULT " + json.dumps(ev, sort_keys=True), flush=True)
