"""Derive a Mogami-class cruiser from the supplied Tone-class hull.

The supplied `mogami-class-cruiser.glb` is byte-identical to `tone-class-cruiser.glb`: one model
under two names. The model itself is a Tone — four main turrets forward of the bridge and a long
flat aviation deck aft. A Mogami in June 1942 carried five turrets, three forward and two on the
quarterdeck, with a shorter aviation area. So rather than draw the same hull twice, this copies the
after pair of the forward turret group, mirrors it to face aft and sets it on the quarterdeck. The
hull, bridge and funnel are shared because the two classes really did share them closely.

Usage: blender -b -P tools/blender/derive-mogami.py -- <aligned-tone.glb> <out.glb|-> [--preview P]
"""
import bpy, bmesh, sys
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:]
src, out = argv[0], argv[1]
preview = argv[argv.index("--preview") + 1] if "--preview" in argv else None

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
body = meshes[0]
bpy.context.view_layer.objects.active = body

co = [body.matrix_world @ v.co for v in body.data.vertices]
lo = Vector((min(p[i] for p in co) for i in range(3)))
hi = Vector((max(p[i] for p in co) for i in range(3)))
length = hi.y - lo.y

# The weather deck is the strongest peak in the height histogram: most of a cruiser's vertices lie
# on it. Anything more than a metre above it in the forward turret band is turret, not deck.
bins = 120
hist = [0] * bins
for p in co:
    hist[min(bins - 1, int((p.z - lo.z) / (hi.z - lo.z) * bins))] += 1
deck_z = lo.z + (hist.index(max(hist)) + 0.5) / bins * (hi.z - lo.z)
print(f"DECK z={deck_z:.2f} of hull {lo.z:.2f}..{hi.z:.2f}")

# Turrets B and C of the forward group: far enough aft of the stem to clear the breakwater, far
# enough forward of the bridge to exclude it.
band = (lo.y + length * 0.17, lo.y + length * 0.32)
sel = [i for i, p in enumerate(co) if band[0] <= p.y <= band[1] and p.z > deck_z + 1.0]
print(f"TURRETS band={band[0]:.1f}..{band[1]:.1f} vertices={len(sel)}")
if not sel:
    raise SystemExit("no turret geometry found in the forward band")

bm = bmesh.new()
bm.from_mesh(body.data)
bm.verts.ensure_lookup_table()
picked = set(sel)
faces = [f for f in bm.faces if all(v.index in picked for v in f.verts)]
print(f"TURRETS faces={len(faces)}")
# bmesh.ops.duplicate rejects a geom list with repeats, and neighbouring faces share their edges
# and vertices, so the set has to be uniqued before it is handed over.
geom = list(dict.fromkeys(
    faces + [e for f in faces for e in f.edges] + [v for f in faces for v in f.verts]))
ret = bmesh.ops.duplicate(bm, geom=geom)
new_verts = [g for g in ret["geom"] if isinstance(g, bmesh.types.BMVert)]

# Mirror about the hull's mid-length so the copied turrets face aft, then slide the pair onto the
# quarterdeck. Mirroring rather than translating is what makes them read as after mounts.
mid_y = (lo.y + hi.y) / 2
shift = -length * 0.06
for v in new_verts:
    v.co.y = 2 * mid_y - v.co.y + shift
bmesh.ops.recalc_face_normals(bm, faces=[f for f in ret["geom"] if isinstance(f, bmesh.types.BMFace)])
bm.to_mesh(body.data)
bm.free()
body.data.update()
body.name = "Mogami class"
print(f"DERIVED triangles={len(body.data.polygons)}")

if preview:
    exec(open(__file__.replace("derive-mogami.py", "_render_views.py")).read())
if out != "-":
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_yup=True)
    print(f"WROTE {out}")
