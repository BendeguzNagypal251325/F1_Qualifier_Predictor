"""Export the "Formula 1 2022 Car" Blender file to glTF (meshes only; its textures are not in the file).

    python -m venv bpyenv && bpyenv/bin/pip install bpy==4.2.0   # Blender as a Python module (Python 3.11)
    bpyenv/bin/python tools/models/blend2glb.py "<path>/Ferrari Mission Winnow.blend" <refs>/f2022/f2022.glb
"""
import sys
import bpy
src, out = sys.argv[-2], sys.argv[-1]
bpy.ops.wm.open_mainfile(filepath=src)
for o in list(bpy.data.objects):
    if o.type != "MESH":
        bpy.data.objects.remove(o)
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_apply=True, export_image_format="NONE", export_yup=True)
print("exported", out)
