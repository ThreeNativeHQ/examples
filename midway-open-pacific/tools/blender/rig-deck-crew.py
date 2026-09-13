"""Rig the supplied WWII sailor mesh to the CC0 Quaternius skeleton and bake deck-crew clips.

The sailor scan is a single unrigged mesh standing with its arms down; the Quaternius Universal
Animation Library rigs are a 65-bone UE5-named skeleton whose rest pose is a T-pose. Automatic
weights bind to the *rest* pose, so a T-pose rest would run the arm bones straight through the
torso. This script swings the upper arms down into the mesh's own pose, applies that as the new
rest, and then corrects every action by the inverse of the same delta so the clips still play
exactly as authored: with rest R' = R.D, a stored basis B must become D^-1.B to leave R'.B' = R.B.

Usage:
  blender -b -P tools/blender/rig-deck-crew.py -- <ual1.glb> <ual2.glb> <sailor.glb> <out.glb>
"""

import math
import sys

import bpy
from mathutils import Quaternion, Vector

# Deck-crew clips, as (source clip name, exported name). The Quaternius libraries share one
# skeleton, so clips from either pack drive the same rig.
#
# Clips are chosen from rendered previews, not names: `Idle_Rail_Call` leans far enough forward
# that the vest's tall collar shears across the face, and `Push_Loop` is a kneeling reach rather
# than a deck push. Both were cut. What remains stays upright and deforms cleanly.
WANTED = [
    ("Idle_Talking_Loop", "crew.signal"),
    ("Idle_Loop", "crew.idle"),
    ("Idle_FoldArms_Loop", "crew.wait"),
    ("Crouch_Idle_Loop", "crew.chock"),
    ("Fixing_Kneeling", "crew.service"),
    ("Walk_Loop", "crew.walk"),
]

# Arm swing applied to the rig's rest pose before binding, measured against the sailor mesh's own
# stance. The shipped sailor is itself T-posed, matching the library rest pose, so both are zero and
# the re-basing below is an identity. Non-zero values are what an arms-down mesh needs.
UPPERARM_DOWN = math.radians(0.0)
LOWERARM_DOWN = math.radians(0.0)


def log(*a):
    print("RIG", *a, flush=True)


def import_glb(path):
    before = set(bpy.data.objects)
    before_actions = set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=path)
    return (
        [o for o in bpy.data.objects if o not in before],
        [a for a in bpy.data.actions if a not in before_actions],
    )


def local_delta(bone, world_rotation):
    """A world-space rotation about the bone's head, expressed in that bone's basis space."""
    rest = bone.matrix_local.to_quaternion()
    return rest.inverted() @ world_rotation @ rest


def action_fcurves(action):
    """Blender 4.4+ moved an action's curves into layered channelbags; 5.x dropped the old list."""
    if hasattr(action, "fcurves"):
        yield from action.fcurves
        return
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                yield from bag.fcurves


def correct_action(action, bone_name, delta):
    """Rewrite one bone's quaternion keys so the clip survives the rest-pose change."""
    path = f'pose.bones["{bone_name}"].rotation_quaternion'
    curves = {fc.array_index: fc for fc in action_fcurves(action) if fc.data_path == path}
    if len(curves) != 4:
        return 0
    inverse = delta.inverted()
    count = min(len(curves[i].keyframe_points) for i in range(4))
    for index in range(count):
        stored = Quaternion([curves[i].keyframe_points[index].co[1] for i in range(4)])
        fixed = inverse @ stored
        for i in range(4):
            point = curves[i].keyframe_points[index]
            point.co[1] = fixed[i]
            point.handle_left[1] = fixed[i]
            point.handle_right[1] = fixed[i]
    for fc in curves.values():
        fc.update()
    return count


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :]
    ual1, ual2, sailor_path, out = argv[:4]

    bpy.ops.wm.read_factory_settings(use_empty=True)

    objects, actions1 = import_glb(ual1)
    armature = next(o for o in objects if o.type == "ARMATURE")
    mannequin = [o for o in objects if o.type == "MESH"]
    log(f"UAL1 armature={armature.name} bones={len(armature.data.bones)} actions={len(actions1)}")

    # The second library targets the same skeleton; keep only its actions.
    objects2, actions2 = import_glb(ual2)
    log(f"UAL2 actions={len(actions2)}")
    for o in objects2:
        bpy.data.objects.remove(o, do_unlink=True)

    by_name = {a.name: a for a in actions1 + actions2}
    missing = [src for src, _ in WANTED if src not in by_name]
    if missing:
        raise SystemExit(f"missing source clips: {missing}")

    # Import the sailor and match it to the skeleton's scale, feet on the floor.
    sailor_objects, _ = import_glb(sailor_path)
    meshes = [o for o in sailor_objects if o.type == "MESH"]
    if len(meshes) != 1:
        raise SystemExit(f"expected one sailor mesh, found {len(meshes)}")
    sailor = meshes[0]
    for o in sailor_objects:
        if o.type != "MESH":
            continue
    bpy.context.view_layer.objects.active = sailor
    sailor.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    lo = Vector((1e9,) * 3)
    hi = Vector((-1e9,) * 3)
    for corner in sailor.bound_box:
        w = sailor.matrix_world @ Vector(corner)
        lo = Vector(map(min, lo, w))
        hi = Vector(map(max, hi, w))
    # Match the mannequin the clips were authored against, not the Head bone's tail: the bone
    # stops at the middle of the skull and would shrink the sailor by a head's height.
    rig_height = max(
        (o.matrix_world @ Vector(c)).z for o in mannequin for c in o.bound_box
    )
    scale = rig_height / (hi.z - lo.z)
    log(f"sailor height={hi.z - lo.z:.3f} mannequin height={rig_height:.3f} scale={scale:.4f}")
    sailor.scale = (scale, scale, scale)
    sailor.location = (
        -(lo.x + hi.x) / 2 * scale,
        -(lo.y + hi.y) / 2 * scale,
        -lo.z * scale,
    )
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    # Clear any imported pose, then swing the arms into the mesh's stance.
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    if armature.animation_data:
        armature.animation_data.action = None
    bpy.ops.object.mode_set(mode="POSE")
    for pb in armature.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = Quaternion()
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)

    deltas = {}
    for side, sign in (("l", 1.0), ("r", -1.0)):
        for name, angle in (
            (f"upperarm_{side}", UPPERARM_DOWN),
            (f"lowerarm_{side}", LOWERARM_DOWN),
        ):
            bone = armature.data.bones[name]
            world = Quaternion(Vector((0, 1, 0)), sign * angle)
            delta = local_delta(bone, world)
            deltas[name] = delta
            armature.pose.bones[name].rotation_quaternion = delta
            log(f"{name}: swing {math.degrees(angle):.1f} deg -> basis {tuple(round(v, 4) for v in delta)}")

    bpy.ops.pose.armature_apply()
    bpy.ops.object.mode_set(mode="OBJECT")

    # Re-base every clip onto the new rest pose.
    for action in by_name.values():
        for bone_name, delta in deltas.items():
            correct_action(action, bone_name, delta)
    log(f"re-based {len(by_name)} actions onto the arms-down rest pose")

    # Bind the sailor; the mannequin is only a reference and must not ship.
    for o in mannequin:
        bpy.data.objects.remove(o, do_unlink=True)

    bpy.ops.object.select_all(action="DESELECT")
    sailor.select_set(True)
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    groups = len(sailor.vertex_groups)
    log(f"bound sailor: {groups} vertex groups, {len(sailor.data.vertices)} vertices")
    if groups < 20:
        raise SystemExit("automatic weights produced too few groups to deform")

    # Keep only the deck-crew clips, under game-facing names.
    keep = {}
    for src, name in WANTED:
        action = by_name[src]
        action.name = name
        action.use_fake_user = True
        keep[name] = action
    for action in list(bpy.data.actions):
        if action.name not in keep:
            action.use_fake_user = False
            bpy.data.actions.remove(action)
    log(f"kept clips: {sorted(keep)}")

    if not armature.animation_data:
        armature.animation_data_create()
    armature.animation_data.action = keep["crew.idle"]

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format="GLB",
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_bake_animation=True,
        export_optimize_animation_size=False,
        export_apply=False,
        use_selection=True,
    )
    log(f"wrote {out}")


main()
