"""Conservative PBR cleanup shared by the supplied-model Blender imports.

Retains embedded colour/normal/metal-roughness maps and UVs. The generated normal maps
overstate dents and panel relief; painted surfaces should not reflect like polished chrome.
Executed inside an already loaded private Blender build scene.
"""
import bpy

for material in bpy.data.materials:
    if not material.use_nodes:
        continue
    for node in material.node_tree.nodes:
        if node.type == "NORMAL_MAP":
            node.inputs["Strength"].default_value = 0.28
        if node.type == "BSDF_PRINCIPLED":
            # Keep spatial material detail. glTF exports these factors multiplied by the maps.
            socket = node.inputs["Metallic"]
            if not socket.is_linked:
                socket.default_value = min(socket.default_value, 0.3)
    # Smooth shading removes the flat triangle facets without moving a single vertex.
for obj in bpy.context.scene.objects:
    if obj.type == "MESH":
        for face in obj.data.polygons:
            face.use_smooth = True
