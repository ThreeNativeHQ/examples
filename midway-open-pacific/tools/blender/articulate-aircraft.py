"""Rigid aircraft parts from an aligned, uniformly scaled supplied mesh.

blender -b -P tools/blender/articulate-aircraft.py -- <body.glb> <out.glb> <tbd|kate>
The measured input files point nose +Z in glTF; output points -Z. No axis is stretched.
"""
import bpy, bmesh, math, sys
from mathutils import Vector, Matrix, Quaternion

src, out, kind = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
body = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
body.data.transform(Matrix.Rotation(math.pi, 4, 'Z') @ body.matrix_world)
body.matrix_world = Matrix.Identity(4)
body.data.update()
bpy.context.view_layer.update()
body.name = 'airframe.body'
points = [v.co.copy() for v in body.data.vertices]
lo = Vector(map(min, zip(*points))); hi = Vector(map(max, zip(*points)))
length, half, height = hi.y-lo.y, (hi.x-lo.x)/2, hi.z-lo.z

def distance(p):
    return (hi.y-p.y)/length

def cut(name, predicate, pivot, planes=()):
    """Bisect at hinges before separation so coarse triangles cannot make jagged cuts."""
    bm = bmesh.new(); bm.from_mesh(body.data)
    for co, normal in planes:
        bmesh.ops.bisect_plane(bm, geom=list(bm.verts)+list(bm.edges)+list(bm.faces),
                              plane_co=co, plane_no=normal, dist=1e-6)
    for face in bm.faces:
        face.select_set(predicate(face.calc_center_median()))
    bm.to_mesh(body.data); bm.free()
    bpy.ops.object.select_all(action='DESELECT')
    body.select_set(True); bpy.context.view_layer.objects.active = body
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.context.tool_settings.mesh_select_mode = (False, False, True)
    bpy.ops.mesh.separate(type='SELECTED')
    bpy.ops.object.mode_set(mode='OBJECT')
    parts = [o for o in bpy.context.selected_objects if o != body]
    assert len(parts) == 1, f'{name}: no usable geometry at measured hinge'
    part = parts[0]; part.name = name
    part.data.transform(Matrix.Translation(-Vector(pivot)))
    part.location = pivot; part.data.update()
    print('PART', name, len(part.data.polygons), tuple(round(x,3) for x in pivot))
    return part

def fit_hinge(part, y0, sweep=0):
    # Fit the axis through the actual cut cross-section, including wing dihedral.
    bpy.context.view_layer.update()
    points=[part.matrix_world @ v.co for v in part.data.vertices]
    edge=[p for p in points if abs(p.y-y0-sweep*p.x)<1e-4]
    assert len(edge)>2, f'{part.name}: missing hinge edge'
    centre=sum(edge,Vector())/len(edge)
    variance=sum((p.x-centre.x)**2 for p in edge)
    slope=sum((p.x-centre.x)*(p.z-centre.z) for p in edge)/max(variance,1e-6)
    old=part.location.copy()
    part.data.transform(Matrix.Translation(old-centre));part.location=centre
    print('HINGE',part.name,tuple(centre),slope)
    return (1,sweep,slope)

def clip(obj, name, axis, angle, spin=False):
    direction = Vector(axis) if isinstance(axis, tuple) else Vector(tuple(1 if i == axis else 0 for i in range(3)))
    direction.normalize()
    obj.rotation_mode = 'QUATERNION'
    obj.animation_data_create()
    obj.animation_data.action = None
    for frame, value in ([(1+i*6, angle*i/4) for i in range(5)] if spin else [(1,0),(25,angle)]):
        obj.rotation_quaternion = Quaternion(direction, value)
        obj.keyframe_insert(data_path='rotation_quaternion', frame=frame)
    action = obj.animation_data.action; action.name = name + '.' + obj.name
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                for fc in bag.fcurves:
                    for key in fc.keyframe_points: key.interpolation='LINEAR'
    track = obj.animation_data.nla_tracks.new(); track.name = name
    strip = track.strips.new(action.name, 1, action)
    strip.action_slot = action.slots[0]
    obj.animation_data.action = None
    obj.rotation_quaternion = Quaternion()

# The spinner tip locates the actual shaft; the source nose is not centred on X=0.
# A cut behind the propeller also selects the cowling, making the engine orbit the shaft.
spinner=[p for p in points if distance(p)<.009]
shaft_x=sum(p.x for p in spinner)/len(spinner)
shaft_z=sum(p.z for p in spinner)/len(spinner)
prop_y=hi.y-length*.042
prop_cut=hi.y-length*(.060 if kind=='kate' else .055)
prop = cut('propeller', lambda p: p.y > prop_cut, (shaft_x,prop_y,shaft_z),
           [((0,prop_cut,0),(0,1,0))])
print('SHAFT',kind,shaft_x,shaft_z,'cut',prop_cut)
clip(prop, 'propeller.spin', 1, math.tau, True)

# Outer trailing edges and the inboard flaps use the source planform, with a straight hinge cut.
hinge_y = hi.y-length*.46
for side, sign in [('left',-1),('right',1)]:
    x0 = half*.52
    aileron = cut('aileron.'+side,
        lambda p,s=sign: s*p.x > x0 and .25 < distance(p) < .62 and p.y < hinge_y+.24*s*p.x,
        (sign*half*.73,hinge_y+.24*half*.73, height*.43),
        [((0,hinge_y,0),(-sign*.24,1,0)),((sign*x0,0,0),(1,0,0))])
    axis=fit_hinge(aileron,hinge_y,sign*.24)
    clip(aileron,'flight.roll-right',axis,sign*math.radians(18))
    clip(aileron,'flight.roll-left',axis,-sign*math.radians(18))
    flap = cut('flap.'+side,
        lambda p,s=sign: half*.16 < s*p.x < x0 and .25 < distance(p) < .62 and p.y < hinge_y+.24*s*p.x,
        (sign*half*.32,hinge_y+.24*half*.32,height*.43),
        [((sign*half*.16,0,0),(1,0,0))])
    clip(flap,'flaps.deploy',fit_hinge(flap,hinge_y,sign*.24),math.radians(30))

tail_y = hi.y-length*.90
elevator = cut('elevator', lambda p: p.y < tail_y and abs(p.x)>half*.07 and p.z<height*.73,
              (0,tail_y,height*.5), [((0,tail_y,0),(0,1,0))])
elevator_axis=fit_hinge(elevator,tail_y)
clip(elevator,'flight.pitch-up',elevator_axis,-math.radians(18))
clip(elevator,'flight.pitch-down',elevator_axis,math.radians(18))
rudder_y = hi.y-length*.93
rudder = cut('rudder',lambda p:p.y<rudder_y and abs(p.x)<half*.07 and p.z>height*.58,
             (0,rudder_y,height*.66), [((0,rudder_y,0),(0,1,0))])
clip(rudder,'flight.rudder-right',2,-math.radians(20))
clip(rudder,'flight.rudder-left',2,math.radians(20))

# Kate's existing mains can be separated below the wing skin. TBD's supplied source has no mains.
if kind == 'kate':
    gear_z = height*.34
    for side,sign in [('left',-1),('right',1)]:
        candidates = [p for p in points if p.z<height*.18 and sign*p.x>half*.12 and .15<distance(p)<.38]
        assert candidates, 'Missing source main wheel'
        hub_x = (min(p.x for p in candidates)+max(p.x for p in candidates))/2
        hub_y = (min(p.y for p in candidates)+max(p.y for p in candidates))/2
        gear = cut('gear.'+side,lambda p,s=sign:p.z<gear_z and s*p.x>half*.12 and .15<distance(p)<.38,
                   (hub_x,hub_y,gear_z), [((0,0,gear_z),(0,0,1))])
        clip(gear,'gear.retract',1,sign*math.pi/2)

if kind == 'tbd':
    def material(name, colour, metallic, roughness):
        mat=bpy.data.materials.new(name);mat.use_nodes=True
        bsdf=mat.node_tree.nodes['Principled BSDF'];bsdf.inputs['Base Color'].default_value=(*colour,1)
        bsdf.inputs['Metallic'].default_value=metallic;bsdf.inputs['Roughness'].default_value=roughness
        return mat
    tyre=material('Tyre rubber',(.018,.021,.025),0,.86)
    metal=material('Painted landing gear',(.30,.36,.39),.35,.44)
    chrome=material('Oleo piston',(.55,.58,.60),.85,.24)
    # Original geometry is gear-up. Raise it as one rigid assembly for blade clearance;
    # newly modelled main wheels define y=0 without stretching the fuselage or wings.
    for obj in list(bpy.context.scene.objects):
        if obj.type=='MESH':obj.location.z+=.4
    for side,sign in [('left',-1),('right',1)]:
        bpy.context.view_layer.update()
        mount=Vector((sign*2.2,hi.y-length*.29,0))
        hit,contact,_,_=body.ray_cast(body.matrix_world.inverted() @ (mount+Vector((0,0,-10))),Vector((0,0,1)))
        assert hit, 'No wing underside above main gear'
        mount.z=(body.matrix_world @ contact).z
        # The source has no wheel well: wheels stow below the supplied wing skin.
        pivot=mount-Vector((0,0,.30));wheel=Vector((sign*2.34,pivot.y-.18,.44))
        assert pivot.z>.55, (pivot, mount)
        print('GEAR MOUNT',side,tuple(mount),'folded tyre top',pivot.z-.18+.44)
        pieces=[]
        def rod(a,b,r,mat):
            a,b=Vector(a),Vector(b)
            bpy.ops.mesh.primitive_cylinder_add(vertices=16,radius=r,depth=(b-a).length,location=(a+b)/2)
            obj=bpy.context.object;obj.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();obj.data.materials.append(mat);pieces.append(obj)
        rod(pivot,wheel,.064,metal)
        rod(pivot.lerp(wheel,.5),wheel,.042,chrome)
        rod(pivot+Vector((0,.1,.0)),wheel+Vector((0,0,.24)),.032,metal)
        bpy.ops.mesh.primitive_torus_add(major_segments=32,minor_segments=12,major_radius=.33,minor_radius=.11,
                                       location=wheel,rotation=(0,math.pi/2,0))
        bpy.context.object.data.materials.append(tyre);pieces.append(bpy.context.object)
        rod(wheel+Vector((-.14,0,0)),wheel+Vector((.14,0,0)),.25,metal)
        rod(wheel+Vector((-.16,0,0)),wheel+Vector((.16,0,0)),.09,chrome)
        bpy.ops.object.select_all(action='DESELECT')
        for obj in pieces:obj.select_set(True)
        bpy.context.view_layer.objects.active=pieces[0];bpy.ops.object.join()
        gear=bpy.context.object;gear.name='gear.'+side
        gear.data.transform(Matrix.Translation(-pivot) @ gear.matrix_world)
        gear.matrix_world=Matrix.Translation(pivot)
        for face in gear.data.polygons:face.use_smooth=True
        clip(gear,'gear.retract',0,-math.pi/2)
        rod(pivot,mount,.064,metal)
        pieces[-1].name='gear.mount.'+side

body['sourceProportionsPreserved'] = True
body['mainGearSource'] = 'present' if kind=='kate' else 'absent in supplied source'
bpy.context.scene.render.fps = 24
bpy.context.scene.frame_set(1)
bpy.context.view_layer.update()
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_yup=True,
                         export_animations=True, export_animation_mode='NLA_TRACKS',
                         export_bake_animation=True, export_extras=True,
                         export_optimize_animation_keep_anim_object=True)
print('WROTE',out)
