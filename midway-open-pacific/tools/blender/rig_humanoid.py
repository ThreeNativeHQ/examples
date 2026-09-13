"""Rig an unrigged T-pose humanoid from measured anatomy, with the CC0 Quaternius UAL rig.

blender -b -P rig_humanoid.py -- <UAL1.glb> <UAL2.glb> <model.glb> <measurements.json> <out.glb>

Run in a private build session: existing objects/actions are cleared. Coordinates are Blender
XYZ metres AFTER height normalization, centred at the feet, facing -Y. Different anatomy needs
new measurements; no source-specific joint positions or geometry cuts live in this module.
See HUMANOID-RIGGING.md for fitting and validation.
"""
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy
import bmesh
from mathutils import Quaternion, Vector



def import_glb(path):
    objects, actions = set(bpy.data.objects), set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=path)
    return list(set(bpy.data.objects) - objects), list(set(bpy.data.actions) - actions)


def smooth(value, low, high):
    t = max(0.0, min(1.0, (value - low) / (high - low)))
    return t * t * (3 - 2 * t)


def chain(value, names, transitions):
    weights = {names[0]: 1.0}
    for i, (low, high) in enumerate(transitions):
        blend = smooth(value, low, high)
        for name in weights:
            weights[name] *= 1 - blend
        weights[names[i + 1]] = blend
    return weights


def bind(character, armature, measurements):
    regions = measurements["weights"]
    body_weights = None
    if measurements.get("bodyWeights", "automatic") == "automatic":
        bpy.ops.object.select_all(action='DESELECT')
        character.select_set(True)
        armature.select_set(True)
        bpy.context.view_layer.objects.active = armature
        bpy.ops.object.parent_set(type='ARMATURE_AUTO')
        body_weights = [{character.vertex_groups[g.group].name: g.weight for g in v.groups}
                        for v in character.data.vertices]
        character.vertex_groups.clear()
        for modifier in list(character.modifiers):
            if modifier.type == 'ARMATURE':
                character.modifiers.remove(modifier)
    groups = {b.name: character.vertex_groups.new(name=b.name) for b in armature.data.bones}
    segments = {}
    for side in ['l', 'r']:
        segments[side] = [('hand', *map(Vector, measurements['palms'][side]))]
        for finger, points in measurements['fingers'][side].items():
            segments[side].extend((f'{finger}_{i + 1:02}', Vector(points[i]), Vector(points[i + 1]))
                                  for i in range(3))
    for v in character.data.vertices:
        x, y, z = v.co
        side = 'l' if x >= 0 else 'r'
        torso = chain(z, ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head'],
                      regions["torso"])
        arm = chain(abs(x), [f'upperarm_{side}', f'lowerarm_{side}', f'hand_{side}'],
                    [regions["elbow"], regions["wrist"]])
        arm_blend = smooth(abs(x), *regions["shoulderX"]) * smooth(z, *regions["shoulderZ"])
        weights = {name: w * (1 - arm_blend) for name, w in torso.items()}
        weights.update({name: w * arm_blend for name, w in arm.items()})
        hand_weight = weights.pop(f'hand_{side}')
        hand_weights = {}
        if hand_weight:
            p = v.co
            influence = {}
            for name, start, end in segments[side]:
                direction = end - start
                t = max(0, min(1, (p - start).dot(direction) / direction.length_squared))
                distance = (p - start - direction * t).length_squared
                influence[f'{name}_{side}'] = 1 / (0.00008 + distance) ** 3
            total = sum(influence.values())
            hand_weights = {name: w * hand_weight / total for name, w in influence.items()}
            weights.update(hand_weights)
        leg_blend = 1 - smooth(z, *regions["hip"])
        for name in weights:
            weights[name] *= 1 - leg_blend
        left = smooth(x, *regions["legSplit"])
        for side, portion in [('l', left), ('r', 1 - left)]:
            leg = chain(z, [f'foot_{side}', f'calf_{side}', f'thigh_{side}'],
                        [regions["ankle"], regions["knee"]])
            weights.update({name: w * leg_blend * portion for name, w in leg.items()})
        if body_weights is not None:
            weights = {name: w * (1 - hand_weight) for name, w in body_weights[v.index].items()}
            for name, weight in hand_weights.items():
                weights[name] = weights.get(name, 0) + weight
        # glTF uses four weights. Normalize explicitly so no neutral/unweighted helper is emitted.
        strongest = sorted(((n, w) for n, w in weights.items() if w > 0.00001),
                           key=lambda item: item[1], reverse=True)[:4]
        total = sum(w for _, w in strongest)
        assert total > 0
        for name, weight in strongest:
            groups[name].add([v.index], weight / total, 'REPLACE')
    character.parent = armature
    mod = character.modifiers.new('Humanoid skin', 'ARMATURE')
    mod.object = armature


def fit_rig(armature, measurements):
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    armature.animation_data_clear()
    bpy.ops.object.mode_set(mode='EDIT')
    targets = dict(measurements['joints'])
    for side in ['l', 'r']:
        for finger, points in measurements['fingers'][side].items():
            for i, point in enumerate(points):
                suffix = f'{i + 1:02}' if i < 3 else '04_leaf'
                targets[f'{finger}_{suffix}_{side}'] = point
    bones = armature.data.edit_bones
    # Imported GLBs can connect bones. Disconnect before translating joint origins.
    for b in bones:
        b.use_connect = False
    for name, point in targets.items():
        bone = bones[name]
        offset = Vector(point) - bone.head
        bone.head += offset
        bone.tail += offset
    for side in ['l', 'r']:
        for finger, points in measurements['fingers'][side].items():
            for i in range(3):
                bone = bones[f'{finger}_{i + 1:02}_{side}']
                x, y, z = points[i + 1]
                bone.tail = (x, y, z)
                # Local Y follows the finger, local Z faces the back of the hand. Flexion is -X
                # on BOTH hands; borrowing the mannequin's bone roll twists the thumb.
                bone.align_roll(Vector(measurements["handNormals"][side]))
    bpy.ops.object.mode_set(mode='OBJECT')


def relax_fingers(action, measurements):
    """Keep authored finger gestures, soften clenched fists, add a small resting curl."""
    motion = measurements["fingerMotion"]
    curves = {fc.data_path: {} for layer in action.layers for strip in layer.strips
              for bag in strip.channelbags for fc in bag.fcurves}
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                for fc in bag.fcurves:
                    curves[fc.data_path][fc.array_index] = fc
    for side, sign in [('l', 1), ('r', -1)]:
        for finger in ["thumb", "index", "middle", "ring", "pinky"]:
            for joint in range(1, 4):
                name = f'{finger}_{joint:02}_{side}'
                tracks = curves.get(f'pose.bones["{name}"].rotation_quaternion', {})
                if len(tracks) != 4:
                    continue
                for k in range(len(tracks[0].keyframe_points)):
                    authored = Quaternion([tracks[i].keyframe_points[k].co.y for i in range(4)])
                    angle = min(authored.angle, 2 * math.pi - authored.angle)
                    curl = math.radians(motion["restDegrees"]) + angle * motion["thumbScale" if finger == "thumb" else "fingerScale"]
                    relaxed = Quaternion((1, 0, 0), -min(curl, math.radians(motion["maxDegrees"])))
                    for i in range(4):
                        point = tracks[i].keyframe_points[k]
                        point.co.y = point.handle_left.y = point.handle_right.y = relaxed[i]
                for fc in tracks.values():
                    fc.update()


def separate_fingers(character, cuts):
    """Apply only the explicitly measured slits; most models need no geometry cuts."""
    for cut in cuts:
        sign = 1 if cut["side"] == "l" else -1
        low, high = cut["z"]
        # Cut only the measured webbing; do not infer a slit from another model.
        points = []
        for x, y, half_width in [cut["start"], cut["end"]]:
            points.extend([(sign*x, y-half_width, low), (sign*x, y+half_width, low),
                           (sign*x, y+half_width, high), (sign*x, y-half_width, high)])
        mesh = bpy.data.meshes.new('Finger gap')
        faces = [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]
        mesh.from_pydata(points, [], faces if sign > 0 else [face[::-1] for face in faces])
        cutter = bpy.data.objects.new('Finger gap', mesh)
        bpy.context.scene.collection.objects.link(cutter)
        bpy.context.view_layer.objects.active = character
        modifier = character.modifiers.new('Separate scanned fingers', 'BOOLEAN')
        modifier.operation = 'DIFFERENCE'
        modifier.solver = 'EXACT'
        modifier.object = cutter
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        bpy.data.objects.remove(cutter, do_unlink=True)
        bpy.data.meshes.remove(mesh)


def pose_hand(armature, side, closed):
    """Inspection pose: 0=open, 0.3=relaxed, 1=fist; thumb stays outside the curled fingers."""
    sign = 1 if side == 'l' else -1
    for finger in ["thumb", "index", "middle", "ring", "pinky"]:
        angles = [15, 25, 20] if finger == 'thumb' else [75, 85, 45]
        for joint, angle in enumerate(angles, 1):
            rotation = Quaternion((1, 0, 0), -math.radians(angle) * closed)
            if finger == 'thumb' and joint == 1:
                rotation = Quaternion((0, 0, 1), sign * math.radians(35) * closed) @ rotation
            armature.pose.bones[f'{finger}_{joint:02}_{side}'].rotation_quaternion = rotation


def validate_measurements(data):
    """Fail before changing the Blender session when calibration data is incomplete."""
    assert data.get("bodyWeights", "automatic") in ["automatic", "anatomical"], "Unknown body binding method"
    assert isinstance(data['name'], str) and data['name'], 'Model name is required'
    assert math.isfinite(data['height']) and data['height'] > 0, 'Height must be positive metres'
    assert isinstance(data['triangles'], int) and data['triangles'] >= 1000, 'Triangle budget must be >= 1000'
    assert data['clips'] and all(len(c) == 2 and all(isinstance(n, str) and n for n in c) for c in data['clips']), 'Clips must map source to output names'
    assert len({c[1] for c in data['clips']}) == len(data['clips']), 'Output clip names must be unique'
    assert all(math.isfinite(v) and v >= 0 for v in data['fingerMotion'].values()), 'Finger motion must be finite and nonnegative'
    points = list(data['joints'].values())
    for side in ['l', 'r']:
        assert set(data['fingers'][side]) == {'thumb', 'index', 'middle', 'ring', 'pinky'}, f'{side}: map all five fingers'
        assert len(data['palms'][side]) == 2, f'{side}: palm needs a wrist and knuckle centre'
        points.extend(data['palms'][side])
        assert Vector(data['palms'][side][0]) != Vector(data['palms'][side][1]), f'{side}: palm has zero length'
        for name, joints in data['fingers'][side].items():
            assert len(joints) == 4, f'{side}/{name}: provide three joints and a tip'
            points.extend(joints)
            assert all(Vector(a) != Vector(b) for a, b in zip(joints, joints[1:])), f'{side}/{name}: zero-length phalanx'
        assert Vector(data['handNormals'][side]).length > 0, f'{side}: hand normal must point out of its back'
    assert all(len(p) == 3 and all(math.isfinite(v) for v in p) for p in points), 'Joint positions must be finite XYZ metres'
    ranges = [v for k, v in data['weights'].items() if k != 'torso'] + data['weights']['torso']
    assert len(data['weights']['torso']) == 5, 'Torso needs five blend regions'
    assert all(len(v) == 2 and all(math.isfinite(n) for n in v) and v[0] < v[1] for v in ranges), 'Blend regions must increase'


def main(ual1, ual2, model_path, out, measurements):
    validate_measurements(measurements)
    assert all(Path(out).resolve() != Path(p).resolve() for p in [ual1, ual2, model_path]), "Output must not overwrite a source GLB"
    if measurements.get("sourceSha256"):
        actual = hashlib.sha256(Path(model_path).read_bytes()).hexdigest()
        assert actual == measurements["sourceSha256"], "Source differs from the measured model; refit its anatomy before binding"
    # Keep the UI context alive when invoked through Blender MCP in a private build session.
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)
    objects, actions = import_glb(ual1)
    armature = next(o for o in objects if o.type == 'ARMATURE')
    other_objects, other_actions = import_glb(ual2)
    by_name = {a.name: a for a in actions + other_actions}
    assert all(src in by_name for src, _ in measurements["clips"]), 'Missing UAL source clip'
    for o in objects + other_objects:
        if o != armature:
            bpy.data.objects.remove(o, do_unlink=True)
    imported, _ = import_glb(model_path)
    meshes = [o for o in imported if o.type == 'MESH']
    assert len(meshes) == 1, 'Expected one unrigged T-pose mesh; join mesh parts in Blender first'
    assert not any(o.type == 'ARMATURE' for o in imported), 'Use an unrigged source mesh'
    character = meshes[0]
    character.name = measurements['name']
    bpy.ops.object.select_all(action='DESELECT')
    character.select_set(True)
    bpy.context.view_layer.objects.active = character
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    lo = Vector(map(min, zip(*(v.co for v in character.data.vertices))))
    hi = Vector(map(max, zip(*(v.co for v in character.data.vertices))))
    assert hi.z > lo.z, "Source mesh has zero height"
    scale = measurements["height"] / (hi.z - lo.z)
    character.scale = (scale,) * 3
    character.location = (-(hi.x + lo.x) * scale / 2, -(hi.y + lo.y) * scale / 2, -lo.z * scale)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # Weld only coincident geometry; UVs remain on face corners. Never voxel-remesh the textures.
    bm = bmesh.new()
    bm.from_mesh(character.data)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=0.00001)
    bm.to_mesh(character.data)
    bm.free()
    decimate = character.modifiers.new('Humanoid mesh budget', 'DECIMATE')
    decimate.ratio = min(1.0, measurements["triangles"] / len(character.data.polygons))
    decimate.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=decimate.name)
    separate_fingers(character, measurements.get("fingerCuts", []))
    for polygon in character.data.polygons:
        polygon.use_smooth = True
    fit_rig(armature, measurements)
    bind(character, armature, measurements)
    keep = []
    for src, name in measurements["clips"]:
        action = by_name[src]
        relax_fingers(action, measurements)
        action.name = name
        action.use_fake_user = True
        keep.append(action)
    for action in list(bpy.data.actions):
        if action not in keep:
            bpy.data.actions.remove(action)
    armature.animation_data_create()
    armature.animation_data.action = keep[0]
    if armature.animation_data.action.slots:
        armature.animation_data.action_slot = armature.animation_data.action.slots[0]
    for image in bpy.data.images:
        if max(image.size) > 2048:
            ratio = 2048 / max(image.size)
            image.scale(round(image.size[0] * ratio), round(image.size[1] * ratio))
            image.pack()
    bpy.ops.object.select_all(action='DESELECT')
    character.select_set(True)
    armature.select_set(True)
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True,
                             export_animations=True, export_animation_mode='ACTIONS',
                             export_bake_animation=True, export_optimize_animation_size=False,
                             export_apply=False)
    print(f'RIG wrote {out}: {len(character.data.vertices)} vertices, {len(character.data.polygons)} triangles')


if __name__ == '__main__':
    ual1, ual2, model, measurements_path, out = sys.argv[sys.argv.index('--') + 1:]
    main(ual1, ual2, model, out, json.loads(Path(measurements_path).read_text()))
