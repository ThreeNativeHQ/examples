"""Render one rigged GLB in several clips at several times, as a contact sheet of PNGs.

Usage: blender -b -P tools/blender/pose-sheet.py -- <rigged.glb> <out-prefix> [clip@t,clip@t...]
"""
import bpy, sys, math
from mathutils import Vector

argv = sys.argv[sys.argv.index("--")+1:]
src, prefix = argv[0], argv[1]
shots = argv[2].split(",") if len(argv) > 2 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
mesh = next(o for o in bpy.context.scene.objects if o.type == "MESH")
actions = {a.name: a for a in bpy.data.actions}
print("POSE clips:", sorted(actions))
if not shots:
    shots = [f"{n}@0.5" for n in sorted(actions)]

world = bpy.data.worlds.new("w"); world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.16, 0.18, 0.21, 1)
bpy.context.scene.world = world
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", type="SUN"))
sun.data.energy = 5; sun.rotation_euler = (math.radians(58), 0, math.radians(30))
bpy.context.scene.collection.objects.link(sun)

cam_data = bpy.data.cameras.new("cam"); cam_data.type = "ORTHO"; cam_data.ortho_scale = 2.3
cam = bpy.data.objects.new("cam", cam_data)
bpy.context.scene.collection.objects.link(cam)
bpy.context.scene.camera = cam
cam.location = Vector((1.9, -2.4, 1.35)); cam.rotation_euler = (math.radians(76), 0, math.radians(38))

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 420; scene.render.resolution_y = 560

if not arm.animation_data:
    arm.animation_data_create()
for shot in shots:
    name, _, at = shot.partition("@")
    action = actions[name]
    arm.animation_data.action = action
    if hasattr(arm.animation_data, "action_slot") and action.slots:
        arm.animation_data.action_slot = action.slots[0]
    start, end = action.frame_range
    frame = start + (end - start) * float(at or 0.5)
    scene.frame_set(int(round(frame)))
    bpy.context.view_layer.update()
    scene.render.filepath = f"{prefix}-{name.replace('.', '_')}.png"
    bpy.ops.render.render(write_still=True)
    print(f"POSE {name} frames {start:.0f}..{end:.0f} at {frame:.0f} -> {scene.render.filepath}")
