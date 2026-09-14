# Orthographic top and side renders of the current scene, used by align-ship.py --preview.
import bpy, math
from mathutils import Vector
scn = bpy.context.scene
world = bpy.data.worlds.new("w"); world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.07, 0.09, 0.12, 1)
scn.world = world
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", type="SUN"))
sun.data.energy = 5; sun.rotation_euler = (math.radians(50), 0, math.radians(30))
scn.collection.objects.link(sun)
lo = Vector((1e18,) * 3); hi = Vector((-1e18,) * 3)
for o in scn.objects:
    if o.type != "MESH": continue
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
mid = (lo + hi) / 2; span = max(hi - lo) * 1.08
cam_data = bpy.data.cameras.new("c"); cam_data.type = "ORTHO"; cam_data.ortho_scale = span
cam = bpy.data.objects.new("c", cam_data); scn.collection.objects.link(cam); scn.camera = cam
scn.render.engine = "BLENDER_EEVEE"
scn.render.resolution_x = 1400; scn.render.resolution_y = 500
scn.render.film_transparent = False
for name, loc, rot, res in (
    ("top",  (mid.x, mid.y, hi.z + span), (0, 0, 0), (500, 1400)),
    ("side", (hi.x + span, mid.y, mid.z), (math.radians(90), 0, math.radians(90)), (1400, 500)),
):
    cam.location = loc; cam.rotation_euler = rot
    scn.render.resolution_x, scn.render.resolution_y = res
    cam_data.ortho_scale = (max(hi.y - lo.y, (hi.z - lo.z) * res[0] / res[1]) * 1.10
                            if name == "side" else span)
    scn.render.filepath = f"{preview}-{name}.png"
    bpy.ops.render.render(write_still=True)
    print(f"PREVIEW {scn.render.filepath}")
scn.render.resolution_x, scn.render.resolution_y = 1200, 800
cam.location = mid + Vector((span * .7, -span * .85, span * .55))
cam.rotation_euler = (mid - cam.location).to_track_quat('-Z', 'Y').to_euler()
cam_data.ortho_scale = span * 1.12
scn.render.filepath = f"{preview}-quarter.png"
bpy.ops.render.render(write_still=True)
