"""Headless orthographic previews of a GLB from the front, side and top.

Usage: blender -b -P tools/blender/preview.py -- <model.glb> <out-prefix> [views]
"""
import bpy, sys, math, os
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
src, prefix = argv[0], argv[1]
views = (argv[2] if len(argv) > 2 else "front,side,top").split(",")

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

objects = [o for o in bpy.context.scene.objects if o.type == "MESH"]
if not objects:
    raise SystemExit("no meshes imported")

lo = Vector((1e9,) * 3)
hi = Vector((-1e9,) * 3)
for o in objects:
    for corner in o.bound_box:
        w = o.matrix_world @ Vector(corner)
        lo = Vector(map(min, lo, w))
        hi = Vector(map(max, hi, w))
centre = (lo + hi) / 2
extent = max(hi - lo) * 1.12
print(f"PREVIEW bounds lo={tuple(round(v,3) for v in lo)} hi={tuple(round(v,3) for v in hi)}")

world = bpy.data.worlds.new("w")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.05, 0.06, 0.08, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
bpy.context.scene.world = world

sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", type="SUN"))
sun.data.energy = 4
sun.rotation_euler = (math.radians(55), 0, math.radians(35))
bpy.context.scene.collection.objects.link(sun)

cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = extent
cam = bpy.data.objects.new("cam", cam_data)
bpy.context.scene.collection.objects.link(cam)
bpy.context.scene.camera = cam

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE" if "BLENDER_EEVEE" in [
    i.identifier for i in scene.render.bl_rna.properties["engine"].enum_items
] else "BLENDER_WORKBENCH"
scene.render.resolution_x = 1400
scene.render.resolution_y = 1400
scene.render.film_transparent = False

PLACES = {
    "front": ((0, -extent, 0), (math.pi / 2, 0, 0)),
    "back":  ((0,  extent, 0), (math.pi / 2, 0, math.pi)),
    "side":  ((extent, 0, 0), (math.pi / 2, 0, math.pi / 2)),
    "top":   ((0, 0, extent), (0, 0, 0)),
}
for view in views:
    offset, rot = PLACES[view]
    cam.location = centre + Vector(offset)
    cam.rotation_euler = rot
    scene.render.filepath = f"{prefix}-{view}.png"
    bpy.ops.render.render(write_still=True)
    print(f"PREVIEW wrote {scene.render.filepath}")
