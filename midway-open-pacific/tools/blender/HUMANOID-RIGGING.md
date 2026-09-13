# Reuse the humanoid rigging pipeline

`rig_humanoid.py` rigs an **unrigged, textured T-pose humanoid** using the CC0 Quaternius UAL1/UAL2
skeleton and clips. It accepts a separate JSON file of measured anatomy. Midway's
`rig-deck-crew.py` is a small caller using `navy-sailor.json`; the shared code contains no sailor
joint coordinates or automatic geometry cuts.

Requirements: Blender 4.4+ with its bundled Python, the two `UAL*_Standard.glb` libraries, and
Node with Three.js for `../check-humanoid.mjs`. The pipeline was exercised on the supplied navy
sailor and a separately exported, unrigged UAL mannequin. New anatomy still needs fitting and
visual inspection; this is not an automatic rigger for arbitrary poses or creatures.

## Fit another model

1. **Inspect the original in Blender MCP.** Work in a private build session: the builder clears
   its objects/actions. Join mesh parts into one object while retaining materials. Remove an old
   rig only on a working copy. The input must stand with arms along X, feet down, facing Blender
   -Y. A-poses, arms against the torso, mittens and missing digits need preparation first.
2. **Copy `navy-sailor.json` to `<model>-measurements.json` and replace its measurements.** Normalize
   a working copy to the desired `height`, centre X/Y and put the soles at Z=0. All positions in
   JSON are **Blender XYZ metres in that normalized space**, not the original GLB's Y-up axes.
   `sourceSha256` pins the unmodified input; update it after fitting the new source. The builder
   rejects a different source file instead of silently using another character's measurements.
3. **Map both hands separately.** `palms` contains wrist and knuckle-centre points. Each of the five
   `fingers` needs four points: base joint, middle joint, distal joint and fingertip. Use three
   anatomical pivots for the thumb: base/opposition, MCP, IP. Centre points inside the flesh, not
   on its surface. `handNormals` points outward through the back of each hand. Check top, palm
   and side views; do not assume the hands are symmetric. The builder aligns each phalanx's local
   Y to its length and local Z to this normal, so flexion bends instead of twisting.
4. **Fit the body and preserve the mesh.** `joints` overrides the UAL bone heads; add torso/head
   entries if their proportions differ. `bodyWeights: "automatic"` uses Blender bone heat for the body and is the default.
   Use `"anatomical"` for scans whose disconnected clothing tears under bone heat (the sailor
   uses this override). Both methods replace hand weights with the explicit finger mapping.
   `weights` gives smooth transition ranges around elbows,
   wrists, shoulders, hips, knees, ankles and the spine. `fingerMotion` controls resting curl and
   how strongly the source finger gestures are retained. Start `fingerCuts` as `[]`: the sailor's
   tiny middle/ring bridge repair is specific to that source. Only add measured slits after
   proving the original fingers are fused. Cuts describe positive X distances and an explicit
   `side`; the builder mirrors their winding correctly on the right.
5. **Build, check and look at the result.** Use the commands below. In Blender MCP, load the output
   and inspect each clip from both sides. With the builder's in-memory armature, detach its action
   before calling `pose_hand(armature, 'l', 0)`, `0.3`, and `1` for open, relaxed and fist poses;
   repeat for `'r'`. The thumb must sit outside the curled fingers. A numerical pass cannot prove
   a natural silhouette or exclude all self-intersection. Body rotations come from UAL; this
   tool does not solve hand-to-body contact IK. Reject or reauthor poses that intersect the new
   body (the sailor rejects `Idle_FoldArms_Loop`). Finally inspect the model through the
   game's actual loader, including close views of fingers, wrists and clothing.

```sh
blender -b -P tools/blender/rig_humanoid.py -- \
  /path/UAL1_Standard.glb /path/UAL2_Standard.glb \
  /path/original.glb /path/model-measurements.json /tmp/rigged.glb

node tools/check-humanoid.mjs /tmp/rigged.glb

# Optional delivery compression; preserve separate vertex buffers for WebGPU.
pnpm exec gltf-transform webp /tmp/rigged.glb public/assets/character.glb \
  --quality 90 --vertex-layout separate
node tools/check-humanoid.mjs public/assets/character.glb
```

`clips` maps source action names to the names the consumer expects. Midway uses six `crew.*`
clips; another game can name or select them differently. The validator requires playable clips,
weighted wrists and all ten fingers, checks thirteen samples per clip on every material primitive,
and exercises both closed fists for motion, seam separation and excessive stretching. Coordinates
and tolerances assume adult-scale metres. It does not promise native-platform validation.

For another project, copy `rig_humanoid.py`, that model's measurement JSON and
`../check-humanoid.mjs`; keep using the existing ThreeNative `SkeletalMesh3D` consumer. Do not copy
Midway's six-clip wrapper or its sailor measurements as if they fit the new mesh.
