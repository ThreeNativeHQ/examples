"""Principal-axis alignment for the supplied Tripo hulls.

Imports a GLB whose hull sits diagonally in its own bounding box, finds the hull's own axes by
covariance of the vertex cloud, rewrites the mesh so length runs along glTF -Z (Blender -Y),
beam along X and the mast up, optionally flips bow/stern, scales uniformly to a reference
length and drops the keel to Z=0. Reports every number it used so the measurement is auditable.

Usage:
  blender -b -P tools/blender/align-ship.py -- <src.glb> <out.glb|-> [--length M] [--flip]
          [--preview PREFIX] [--waterline FRAC]
"""
import bpy, sys, math
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:]
src, out = argv[0], argv[1]
opt = argv[2:]
def flag(name, default=None, cast=float):
    if name in opt:
        return cast(opt[opt.index(name) + 1])
    return default
target_length = flag("--length")
target_beam = flag("--beam")
target_height = flag("--height")
draught = flag("--draught", 0.0)
waterline = flag("--waterline", 0.0)
preview = flag("--preview", None, str)
assert not flag("--decimate", 0, int), "Simplify before alignment with gltf-transform; Blender collapse damages these meshes"
flip = "--flip" in opt

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
if not meshes:
    raise SystemExit("no meshes imported")

# Vertex cloud in world space, sampled for speed on the million-triangle hulls.
pts = []
for o in meshes:
    mw = o.matrix_world
    verts = o.data.vertices
    step = max(1, len(verts) // 60000)
    # bpy_prop_collection refuses a stepped slice; index it instead.
    pts.extend(mw @ verts[i].co for i in range(0, len(verts), step))
n = len(pts)
centre = sum(pts, Vector((0, 0, 0))) / n

# Plan-view covariance (Blender XY): the long axis of a hull dominates it.
sxx = sxy = syy = 0.0
for p in pts:
    d = p - centre
    sxx += d.x * d.x; sxy += d.x * d.y; syy += d.y * d.y
theta = 0.5 * math.atan2(2 * sxy, sxx - syy)   # major axis direction in XY
# Rotate so the major axis lands on -Y (glTF forward).
# Blender's +Y-up glTF exporter maps Blender +Y to glTF -Z, so the bow must finish on +Y.
yaw = -(theta - math.pi / 2)
R = Matrix.Rotation(yaw, 4, "Z")
pts = [R @ (p - centre) for p in pts]

# Elevation covariance in the (Y, Z) plane levels a hull that also sits nose-down.
syy = syz = szz = 0.0
for p in pts:
    syy += p.y * p.y; syz += p.y * p.z; szz += p.z * p.z
pitch = 0.5 * math.atan2(2 * syz, syy - szz)
P = Matrix.Rotation(-pitch, 4, "X")
pts = [P @ p for p in pts]
M = P @ R @ Matrix.Translation(-centre)

lo = Vector((min(p[i] for p in pts) for i in range(3)))
hi = Vector((max(p[i] for p in pts) for i in range(3)))
raw_len, raw_beam, raw_height = hi.y - lo.y, hi.x - lo.x, hi.z - lo.z

# Which end is finer? Compare mean |x| of the forward and after tenths at hull level.
def taper(sign):
    edge = (hi.y if sign > 0 else lo.y)
    band = [p for p in pts if abs(p.y - edge) < raw_len * 0.12]
    return (sum(abs(p.x) for p in band) / len(band)) if band else 0.0
fine_end = "+Y" if taper(1) < taper(-1) else "-Y"

# Beam and length measured where a class reference measures them: at the waterline, not across
# sponsons and yardarms. The waterline sits `draught` above the keel once the hull is dropped.
def at_waterline(frac):
    z0 = lo_z + (hi_z - lo_z) * 0.0
    band = [p for p in pts if abs(p.z - (lo_z + frac)) < (hi_z - lo_z) * 0.02]
    if not band:
        return 0.0, 0.0
    return (max(p.x for p in band) - min(p.x for p in band),
            max(p.y for p in band) - min(p.y for p in band))
lo_z = min(p.z for p in pts); hi_z = max(p.z for p in pts)

wl_beam, wl_len = at_waterline(draught / (target_length / raw_len) if target_length else draught)
print(f"WATERLINE band beam={wl_beam:.4f} length={wl_len:.4f} "
      f"(as fraction of raw: beam={wl_beam / raw_beam:.3f} length={wl_len / raw_len:.3f})")
print(f"ALIGN yaw={math.degrees(yaw):.2f} pitch={math.degrees(pitch):.2f} "
      f"raw L={raw_len:.4f} B={raw_beam:.4f} H={raw_height:.4f} "
      f"ratio L/B={raw_len / raw_beam:.2f} finer_end={fine_end} "
      f"taper(+Y)={taper(1):.4f} taper(-Y)={taper(-1):.4f}")

if flip:
    M = Matrix.Rotation(math.pi, 4, "Z") @ M
scale = (target_length / raw_len) if target_length else 1.0
M = Matrix.Scale(scale, 4) @ M
# A class dimension is metadata, not permission to squash an authored model.
# Match length with ONE scalar; preserve beam/height and report their actual values below.
print(f"PROPORTIONS uniform scale={scale:.6f}; reference beam={target_beam}, height={target_height}")

# Bake into mesh data: a rotated object transform would leave bound_box reporting the
# axis-aligned box of the unrotated hull, which reads as a beam twice the real one.
# Fail before export if any future change introduces independent axis scaling.
axes = M.to_scale()
assert max(axes) - min(axes) < max(axes) * 1e-5, ('Nonuniform asset scale', tuple(axes))

for o in meshes:
    o.data.transform(M @ o.matrix_world)
    o.matrix_world = Matrix.Identity(4)
bpy.context.view_layer.update()

def extents():
    lo = Vector((1e18,) * 3); hi = Vector((-1e18,) * 3)
    for o in meshes:
        for v in o.data.vertices:
            lo = Vector(map(min, lo, v.co)); hi = Vector(map(max, hi, v.co))
    return lo, hi
lo, hi = extents()
drop = Vector((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z + waterline))
for o in meshes:
    o.data.transform(Matrix.Translation(drop))
bpy.context.view_layer.update()
lo, hi = extents()
print(f"FINAL length={hi.y - lo.y:.3f} beam={hi.x - lo.x:.3f} height={hi.z - lo.z:.3f} "
      f"keel_z={lo.z:.3f} scale={scale:.6f}")

exec(open(__file__.replace("align-ship.py", "polish-materials.py")).read())
if preview:
    exec(open(__file__.replace("align-ship.py", "_render_views.py")).read())
if out != "-":
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_yup=True)
    print(f"WROTE {out}")
