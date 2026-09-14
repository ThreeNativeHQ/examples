"""Uniform span alignment for the supplied fused aircraft.

Run tools/import-aircraft.sh: error-bounded simplification precedes this step;
articulate-aircraft.py follows it, supplying final nose -Z and moving parts.
Published length/height are reference metadata and never deform the mesh.
"""
import bpy, sys, math
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:]
src, out = argv[0], argv[1]
opt = argv[2:]
def flag(name, default=None, cast=float):
    return cast(opt[opt.index(name) + 1]) if name in opt else default
target_span = flag("--span")
target_length = flag("--length")
target_height = flag("--height")
assert not flag("--decimate", 0, int), "Simplify before alignment with gltf-transform; Blender collapse damages these meshes"
preview = flag("--preview", None, str)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
if not meshes:
    raise SystemExit("no meshes imported")

pts = []
for o in meshes:
    mw, verts = o.matrix_world, o.data.vertices
    step = max(1, len(verts) // 80000)
    pts.extend(mw @ verts[i].co for i in range(0, len(verts), step))
centre = sum(pts, Vector((0, 0, 0))) / len(pts)

# Span is the largest dimension of every aeroplane here, so the right yaw is simply the one whose
# X extent is largest. Covariance gets this wrong: Tripo puts most of its vertices in the engine and
# canopy, so the principal axis of the vertex cloud is the fuselage, not the wing.
local = [p - centre for p in pts]
best_yaw, best_extent = 0.0, -1.0
for deg in range(180):
    a = math.radians(deg); ca, sa = math.cos(a), math.sin(a)
    xs = [ca * p.x - sa * p.y for p in local]
    e = max(xs) - min(xs)
    if e > best_extent:
        best_extent, best_yaw = e, a
theta = -best_yaw
R = Matrix.Rotation(best_yaw, 4, "Z")
pts = [R @ p for p in local]

lo = Vector((min(p[i] for p in pts) for i in range(3)))
hi = Vector((max(p[i] for p in pts) for i in range(3)))
span, length, height = hi.x - lo.x, hi.y - lo.y, hi.z - lo.z

# The fin is the tallest thing on the aeroplane and it is at the tail, so the end whose highest
# geometry is lower is the nose. Unlike a hull's taper this is not ambiguous.
def top_of(sign):
    edge = hi.y if sign > 0 else lo.y
    band = [p for p in pts if abs(p.y - edge) < length * 0.15]
    return max(p.z for p in band) if band else 0.0
nose = "+Y" if top_of(1) < top_of(-1) else "-Y"
print(f"AIRCRAFT yaw={math.degrees(best_yaw):.2f} span={span:.4f} length={length:.4f} "
      f"height={height:.4f} span/length={span / length:.3f} nose={nose} "
      f"fin_top(+Y)={top_of(1):.4f} fin_top(-Y)={top_of(-1):.4f}")

M = R @ Matrix.Translation(-centre)
# glTF -Z is Blender +Y under the +Y-up exporter, so the nose has to finish on +Y, not -Y.
if nose == "-Y":
    M = Matrix.Rotation(math.pi, 4, "Z") @ M
scale = (target_span / span) if target_span else 1.0
M = Matrix.Scale(scale, 4) @ M
# Preserve the artist's proportions. Published dimensions are references, never separate scales.
print(f"PROPORTIONS uniform scale={scale:.6f}; reference length={target_length}, height={target_height}")

# Fail before export if any future change introduces independent axis scaling.
axes = M.to_scale()
assert max(axes) - min(axes) < max(axes) * 1e-5, ('Nonuniform asset scale', tuple(axes))

for o in meshes:
    o.data.transform(M @ o.matrix_world)
    o.matrix_world = Matrix.Identity(4)
bpy.context.view_layer.update()

def extents(objs):
    lo = Vector((1e18,) * 3); hi = Vector((-1e18,) * 3)
    for o in objs:
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
    return lo, hi
lo, hi = extents(meshes)
drop = Vector((-(lo.x + hi.x) / 2, 0.0, -lo.z))
for o in meshes:
    o.data.transform(Matrix.Translation(drop))
lo, hi = extents(meshes)
print(f"SCALED span={hi.x - lo.x:.3f} length={hi.y - lo.y:.3f} height={hi.z - lo.z:.3f} "
      f"scale={scale:.6f} (reference length {target_length})")

# Intermediate body faces glTF +Z; articulate-aircraft.py supplies the final -Z turn.
for obj in meshes:
    obj.data.transform(Matrix.Rotation(math.pi, 4, "Z"))
meshes[0].name = "airframe.body"
exec(open(__file__.replace("align-aircraft.py", "polish-materials.py")).read())
if preview:
    exec(open(__file__.replace("align-aircraft.py", "_render_views.py")).read())
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_yup=True)
print(f"WROTE {out}")
