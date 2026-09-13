"""Alignment and moving-part separation for the supplied fused aircraft.

The supplied airframes are one fused mesh with no named propeller, gear or control surface, sitting
at an arbitrary yaw. This puts the span on X and the nose on -Z (glTF forward), drops the wheels to
y = 0, scales uniformly to the reference span, and then cuts the two parts the game has to turn:
the propeller disc and the main gear. Each becomes its own object with its pivot at the real hinge,
so game code can rotate it without a baked clip.

Usage:
  blender -b -P tools/blender/align-aircraft.py -- <src.glb> <out.glb|-> --span M --length M
          [--decimate N] [--preview PREFIX] [--no-gear]
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
budget = flag("--decimate", 0, int)
preview = flag("--preview", None, str)
# Gear separation is opt-in and still experimental: on these fused meshes a geometric selection
# takes the wheel and the lower strut but leaves the upper leg in the body, which retracts wrong.
# Prop separation is the part that is correct, so it is the part that ships.
want_gear = "--gear" in opt

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
# Same declared repair the hulls get: these airframes are long for their span. Span sets the uniform
# scale because it is the dimension a wing planform is judged by; length and height are corrected
# against their published figures and the factors are printed.
len_fix = (target_length / (length * scale)) if target_length else 1.0
ht_fix = (target_height / (height * scale)) if target_height else 1.0
if target_length or target_height:
    M = Matrix.Diagonal((1.0, len_fix, ht_fix, 1.0)) @ M
    print(f"REPAIR length x{len_fix:.4f} height x{ht_fix:.4f} "
          f"({length * scale:.2f}->{target_length or 0:.2f} m, {height * scale:.2f}->{target_height or 0:.2f} m)")

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

if budget:
    for o in meshes:
        bpy.ops.object.select_all(action="DESELECT")
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        # Tripo splits a vertex at every UV seam. Collapsing an unwelded mesh tears it into shards,
        # which is what a 94% decimation of the Devastator looked like; merging first keeps the skin.
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.remove_doubles(threshold=1e-4)
        bpy.ops.object.mode_set(mode="OBJECT")
        o.modifiers.new("tri", "TRIANGULATE"); bpy.ops.object.modifier_apply(modifier="tri")
    print(f"WELD -> {sum(len(o.data.polygons) for o in meshes)} faces")
    total = sum(len(o.data.polygons) for o in meshes)
    # Blender's decimate ratio is a request, not a promise: one pass at budget/total lands high.
    # Re-apply until it is actually under, rather than shipping a model over its stated budget.
    for _ in range(4):
        now = sum(len(o.data.polygons) for o in meshes)
        if now <= budget:
            break
        for o in meshes:
            # modifier_apply silently does nothing unless the object is both selected and active,
            # which is why a second decimation pass looked like a no-op.
            bpy.ops.object.select_all(action="DESELECT")
            o.select_set(True)
            bpy.context.view_layer.objects.active = o
            m = o.modifiers.new("dec", "DECIMATE"); m.ratio = min(1.0, (budget / now) * 0.97)
            bpy.ops.object.modifier_apply(modifier="dec")
        print(f"  decimate pass: {now} -> {sum(len(o.data.polygons) for o in meshes)}")
    print(f"DECIMATE {total} -> {sum(len(o.data.polygons) for o in meshes)} (budget {budget})")
    # Decimation moves the lowest vertex, so the wheels have to be set back on the deck afterwards.
    lo2, hi2 = extents(meshes)
    for o in meshes:
        o.data.transform(Matrix.Translation(Vector((-(lo2.x + hi2.x) / 2, 0.0, -lo2.z))))
    lo2, hi2 = extents(meshes)
    print(f"REDROP wheels_z={lo2.z:.4f} span={hi2.x - lo2.x:.3f} length={hi2.y - lo2.y:.3f}")

body = meshes[0]
lo, hi = extents([body])

def separate(name, predicate, pivot):
    """Cut every vertex satisfying `predicate` into its own object with its origin at `pivot`."""
    import bmesh
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.mode_set(mode="EDIT")
    bm = bmesh.from_edit_mesh(body.data)
    bm.verts.ensure_lookup_table()
    for v in bm.verts:
        v.select = predicate(v.co)
    for f in bm.faces:
        f.select = all(v.select for v in f.verts)
    picked = sum(1 for f in bm.faces if f.select)
    bmesh.update_edit_mesh(body.data)
    if picked == 0:
        bpy.ops.object.mode_set(mode="OBJECT")
        print(f"PART {name} EMPTY")
        return None
    bpy.ops.mesh.separate(type="SELECTED")
    bpy.ops.object.mode_set(mode="OBJECT")
    part = [o for o in bpy.context.selected_objects if o is not body][-1]
    part.name = name
    part.data.transform(Matrix.Translation(-pivot))
    part.matrix_world = Matrix.Translation(pivot)
    print(f"PART {name} faces={picked} pivot=({pivot.x:.3f},{pivot.y:.3f},{pivot.z:.3f})")
    return part

# Propeller: in the forward few per cent of the fuselage, the blades reach far further from the
# shaft than the cowling does. Find the slice where that radius jumps and cut everything ahead of it.
# The alignment above always finishes with the nose on +Y, so the scan runs aft from hi.y.
nose_y = hi.y
axis_z = None
best = None
for i in range(40):
    y0 = nose_y - (hi.y - lo.y) * 0.0025 * i
    sl = [v for o in [body] for v in (o.matrix_world @ vv.co for vv in o.data.vertices)
          if y0 - (hi.y - lo.y) * 0.0025 <= v.y < y0]
    if len(sl) < 8:
        continue
    cz = sum(v.z for v in sl) / len(sl)
    rad = max(math.hypot(v.x, v.z - cz) for v in sl)
    if best is None or rad > best[1]:
        best = (y0, rad, cz)
prop_y, prop_r, axis_z = best
profile = []
for i in range(30):
    y0 = nose_y - (hi.y - lo.y) * 0.005 * i
    sl = [v for v in (body.matrix_world @ vv.co for vv in body.data.vertices)
          if y0 - (hi.y - lo.y) * 0.005 <= v.y < y0]
    if len(sl) < 6:
        profile.append(0.0); continue
    cz = sum(v.z for v in sl) / len(sl)
    profile.append(max(math.hypot(v.x, v.z - cz) for v in sl))
print("NOSEPROFILE " + " ".join(f"{r:.2f}" for r in profile))
cowl = [v for v in (body.matrix_world @ vv.co for vv in body.data.vertices)
        if prop_y - (hi.y - lo.y) * 0.06 <= v.y < prop_y - (hi.y - lo.y) * 0.03]
cowl_r = max(math.hypot(v.x, v.z - axis_z) for v in cowl) if cowl else prop_r * 0.4
cut_y = prop_y - (hi.y - lo.y) * 0.02
print(f"PROP disc_y={prop_y:.3f} radius={prop_r:.3f} cowl_radius={cowl_r:.3f} axis_z={axis_z:.3f}")
separate("propeller", lambda co: co.y > cut_y, Vector((0.0, prop_y, axis_z)))

if want_gear:
    # Main gear: strictly below the wing underside. A threshold anywhere near mid-height cuts into
    # the wing panel itself on a low-wing monoplane, which shows up as coloured patches on the
    # underside rather than a leg, so keep it in the bottom quarter and outboard of the fuselage.
    wing_z = lo.z + (hi.z - lo.z) * 0.26
    for side, sgn in (("gear.left", -1), ("gear.right", 1)):
        xs = [v.x for v in (body.matrix_world @ vv.co for vv in body.data.vertices)
              if v.z < wing_z and sgn * v.x > (hi.x - lo.x) * 0.04 and v.y > hi.y - (hi.y - lo.y) * 0.55]
        if not xs:
            print(f"PART {side} EMPTY"); continue
        hub_x = sum(xs) / len(xs)
        separate(side, lambda co, s=sgn, wz=wing_z: (
            co.z < wz and s * co.x > (hi.x - lo.x) * 0.04 and co.y > hi.y - (hi.y - lo.y) * 0.55),
            Vector((hub_x, hi.y - (hi.y - lo.y) * 0.30, wing_z)))

if preview:
    # Flat colour on the cut parts so a render shows exactly what was taken: a gear selection that
    # swallowed the wing underside is obvious in the picture and invisible in the face count.
    for name, rgb in (("propeller", (0.9, 0.1, 0.1, 1)), ("gear.left", (0.1, 0.9, 0.2, 1)),
                      ("gear.right", (0.2, 0.4, 1.0, 1))):
        o = bpy.data.objects.get(name)
        if not o:
            continue
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = rgb
        m.node_tree.nodes["Principled BSDF"].inputs["Emission Color"].default_value = rgb
        m.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 0.6
        o.data.materials.clear(); o.data.materials.append(m)
    exec(open(__file__.replace("align-aircraft.py", "_render_views.py")).read())
if out != "-":
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_yup=True)
    print(f"WROTE {out}")
