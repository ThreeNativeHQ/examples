import type { ICtx } from "@threenative/core";
import { Scene } from "@threenative/core";
import { type IMetaHuman, loadMetaHuman } from "@threenative/metahuman";
import { Group, Matrix4, type Mesh, type Object3D, type PerspectiveCamera, type SkinnedMesh } from "three";
import { FaceCamera } from "../render/camera.js";
import {
  applySpecimenMaterials,
  loadSpecimenMaps,
  shirtLook,
  type SpecimenMaps,
} from "../render/materials.js";
import { disposeTemporalAA, installTemporalAA } from "../render/post.js";
import {
  browFollow,
  hairShading,
  type IBrowSkin,
  type IStrands,
  parseStrands,
  StrandMesh,
  stageLights,
} from "../render/strands.js";
import { BROW_LOOK, HAIR_LOOK } from "../render/look.js";
import {
  frameFace,
  measureFraming,
  setupStage,
  subjectRadius,
  swayLashes,
  VANTAGES,
  type VantageName,
} from "../render/stage.js";
import type { GameState } from "../state.js";
import { CONTROL_GROUPS, PRESENTED_ALIASES } from "../ui/groups.js";

export type LabCtx = ICtx<GameState>;

/** The prepared specimen, by the logical paths `tools/prepare.mjs` writes. */
const MODEL = "content/specimen.glb";
const DNA = "content/head.dna";
const BINDINGS = "content/bindings.json";

/**
 * The rest of Ada, loaded beside the specimen rather than inside it.
 *
 * The groom and the shirt are *not* welded into `specimen.glb`. The groom is strands
 * (`src/render/strands.ts`): 65 980 hair fibres hung off the head joint, and 1 354 brow fibres that
 * ride the face mesh's own skin root by root. The brow cards are still welded into the specimen,
 * because its bindings carry their morphs, but they are no longer drawn.
 *
 * The shirt is here for a different reason, and it is the largest visible gap in the frame: the
 * face mesh's own neck ends at a ring, and the portrait has air under the chin where the
 * reference has a collar. `content/shirt.glb` is the sample's own `f_med_nrw_top_shirt_nrm` — 18 946
 * vertices, 33 716 triangles, carrying the whole body skeleton.
 *
 * **Its placement is identity, and it is measured rather than eyeballed.** It is not the same file
 * as the body LOD this comment used to describe: read out of both GLBs, its `root`, `pelvis`,
 * `spine_05`, `neck_01`, `neck_02`, `head`, `clavicle_l/r` and `upperarm_l/r` all resolve to the
 * specimen's own world translations to five decimals — `pelvis` 0, 0.87071, 0.02095, `neck_01`
 * 0, 1.32989, −0.02048, `head` 0, 1.43358, 0.00133 — under the same `root` rest rotation, so the two
 * files are already in one space. Its geometry spans y 0.8929..1.3874, which puts the collar at the
 * jaw. It is added to the scene at identity and parented to nothing: it hangs on `spine_05` and
 * `clavicle_l/r` in its own skin, and parenting it to the head bone would rotate a shirt with a
 * head.
 */
/** The groom as strands, converted by `tools/prepare.mjs --strands`. */
const HAIR_STRAND_FILE = "content/hair.strands.bin";
const BROW_STRAND_FILE = "content/brows.strands.bin";
const BROW_SKIN_FILE = "content/brows.skin.json";
const SHIRT = "content/shirt.glb";

/**
 * Hang an object off the head bone, undoing that bone's rest transform so it lands where the
 * exporter put it.
 *
 * The groom is authored in the specimen's own rest space — measured, the strands span y 1.416..1.633
 * and the head mesh y 1.2426..1.5914, both metres with y up — so nothing needs a hand-typed offset.
 * What they *do* need is a parent, and `head` is the joint that means "the head moved": its rest
 * world matrix is not identity, so the inverse is decomposed into the child's own local transform
 * rather than left as a `matrixAutoUpdate = false` trick whose update order nothing in this sample
 * would ever exercise.
 */
function attachToHead(head: Object3D | undefined, child: Object3D): void {
  if (head === undefined) return;
  head.updateWorldMatrix(true, false);
  REST.copy(head.matrixWorld).invert().decompose(child.position, child.quaternion, child.scale);
  head.add(child);
}

const REST = new Matrix4();

/** A pose recipe in alias space, blended before evaluation rather than after it. */
type Recipe = Readonly<Record<string, number>>;

const RECIPES: Readonly<Record<string, Recipe>> = {
  neutral: {},
  smile: { smileL: 0.8, smileR: 0.8, cheekRaiseL: 0.35, cheekRaiseR: 0.35 },
  brow: { browRaiseInnerL: 0.7, browRaiseInnerR: 0.7, browRaiseOuterL: 0.5, browRaiseOuterR: 0.5 },
  // The one recipe that opens the mouth, so a capture can show the teeth and the tongue-lit
  // interior against the same neutral the other two are compared with — and the chin is the part
  // of that which is not a faceboard channel at all, so the jaw poses are what the chin/neck
  // continuity check is actually looking at.
  expression: { jawOpen: 0.6, smileL: 0.5, smileR: 0.5 },
};

/** The joint and morph channels a playtest samples, named as the DNA carries them. */
const PROBES = {
  jaw: "jaw_open",
  blinkLeft: "eye_blink_L",
  blinkRight: "eye_blink_R",
  smileLeft: "mouth_cornerPull_left",
} as const;

interface IDomain {
  readonly min: number;
  readonly max: number;
  readonly default: number;
}

export class Lab extends Scene<GameState> {
  static override readonly initialState: GameState = {
    phase: "loading",
    stage: "starting",
    loadedBytes: 0,
    knownBytes: 0,
    message: "",
    controls: {},
    domains: {},
    linked: Object.fromEntries(CONTROL_GROUPS.map((group) => [group.id, false])),
    backend: "",
    openRigLogic: "",
    lod: 0,
    joints: 0,
    blendShapes: 0,
    animatedMaps: 0,
    evaluationMs: 0,
    frames: 0,
    fps: 0,
    strands: 0,
    probeJawJoint: 0,
    probeJawMorph: 0,
    probeBlinkMorphLeft: 0,
    probeBlinkMorphRight: 0,
    probeSmileMorphLeft: 0,
    uiReady: false,
  };

  #human: IMetaHuman | undefined;
  #shirt: Group | undefined;
  #hairStrands: IStrands | undefined;
  #browStrands: IStrands | undefined;
  #browSkin: IBrowSkin | undefined;
  #followBrows: () => void = () => undefined;
  #strandMesh: StrandMesh | undefined;
  #maps: SpecimenMaps = new Map();
  #face: FaceCamera | undefined;
  #camera: PerspectiveCamera | undefined;
  #domains: Readonly<Record<string, IDomain>> = {};
  /** Aliases the UI changed since the last rendered frame; coalesced into one `setControls`. */
  readonly #pending = new Map<string, number>();
  /** The last published vector, so a frame that changes one control keeps the other 32. */
  #controls: Readonly<Record<string, number>> = {};
  #linkPatch: Record<string, boolean> = {};
  #linked: Readonly<Record<string, boolean>> = {};
  /** The alias on the other side of the same UI row, and the group that row belongs to. */
  readonly #mirror = new Map<string, { group: string; other?: string }>();
  #readMorph: (channel: string) => number = () => 0;
  #jaw: Object3D | undefined;
  /** The jaw node's bind-time local transform, captured at load: the rig's deltas compose onto it. */
  #jawRest: readonly number[] = [];
  #frames = 0;

  override async load(ctx: LabCtx): Promise<void> {
    try {
      ctx.state.set({ stage: "binding the DNA rig", phase: "loading" });
      const human = await loadMetaHuman({
        assets: ctx.assets,
        model: MODEL,
        dna: DNA,
        bindings: BINDINGS,
        lod: 0,
      });
      const unpresented = human.controls
        .map((control) => control.alias)
        .filter((alias) => !PRESENTED_ALIASES.has(alias));
      if (unpresented.length > 0)
        throw new Error(`the UI has no row for ${unpresented.join(", ")}; add one before running`);
      this.#human = human;
      // `model()` hands back the loader's whole `GLTF`, so it is `.scene` that is wanted; the shirt
      // carries no animation, so there is nothing else in it.
      const shirt = await ctx.assets.model<{ scene: Group }>(SHIRT);
      this.#shirt = shirt.scene;
      const [hairBytes, browBytes, browSkin] = await Promise.all([
        readBytes(ctx, HAIR_STRAND_FILE),
        readBytes(ctx, BROW_STRAND_FILE),
        readBytes(ctx, BROW_SKIN_FILE),
      ]);
      this.#hairStrands = parseStrands(hairBytes);
      this.#browStrands = parseStrands(browBytes);
      this.#browSkin = JSON.parse(new TextDecoder().decode(browSkin)) as IBrowSkin;
      // The look is part of loading, not part of entering: a missing texture is a load failure the
      // panel can say out loud, and the eyes never appear on an untextured head even for a frame.
      this.#maps = await loadSpecimenMaps(ctx.assets);
      for (const group of CONTROL_GROUPS) {
        for (const row of group.rows) {
          this.#mirror.set(row.left, { group: group.id, other: row.right });
          if (row.right !== undefined) this.#mirror.set(row.right, { group: group.id, other: row.left });
        }
      }
      this.#domains = Object.fromEntries(
        human.controls.map((control) => [control.alias, { min: control.min, max: control.max, default: control.default }]),
      );
      const diagnostics = human.diagnostics();
      ctx.state.set({
        phase: "ready",
        stage: "ready",
        controls: this.#controls = Object.fromEntries(
          human.controls.map((control) => [control.alias, control.default]),
        ),
        domains: Object.fromEntries(
          human.controls.map((control) => [control.alias, [control.min, control.max] as const]),
        ),
        backend: diagnostics.backend,
        openRigLogic: diagnostics.openRigLogic,
        lod: diagnostics.lod,
        joints: diagnostics.joints,
        blendShapes: diagnostics.blendShapes,
        animatedMaps: diagnostics.animatedMaps,
      });
    } catch (error) {
      // An unprepared `content/` is this sample's expected first run, and it has one right answer.
      const code = (error as { code?: string }).code ?? "";
      const absent = code === "TN_MH_WASM_LOAD" || /TN_ASSETS_UNRESOLVED/.test(String(error));
      ctx.state.set({
        phase: absent ? "missing-content" : "error",
        stage: absent ? "content not found" : "load failed",
        message: absent
          ? "This lab needs a prepared specimen. Run `node tools/prepare.mjs`: it reads the licensed " +
            "Ada_FaceMesh GLB and its head DNA, then writes specimen.glb, head.dna and bindings.json into content/."
          : String(error instanceof Error ? error.message : error),
      });
    }
  }

  /**
   * One alias the UI asked for.
   *
   * Nothing is clamped: a value outside the specimen's declared domain is a bug in the caller,
   * and a silently clamped face is a worse bug report than a throw.
   */
  setControl(alias: string, value: number): void {
    const domain = this.#domains[alias];
    if (domain === undefined) throw new Error(`no control is declared as '${alias}'`);
    if (!Number.isFinite(value)) throw new Error(`${alias} was given ${String(value)}`);
    if (value < domain.min || value > domain.max)
      throw new Error(`${alias} was given ${value}, outside [${domain.min}, ${domain.max}]`);
    this.#pending.set(alias, value);
    this.#mirrorTo(alias, value);
  }

  /** A linked row drives both faces from the side that moved; an unlinked one drives only itself. */
  #mirrorTo(alias: string, value: number): void {
    const entry = this.#mirror.get(alias);
    if (entry === undefined || entry.other === undefined) return;
    if (this.#linked[entry.group] !== true) return;
    this.#pending.set(entry.other, value);
  }

  /** Linking applies from the next edit onwards, so the toggle itself never snaps a face. */
  setLinked(group: string, linked: boolean): void {
    this.#linked = { ...this.#linked, [group]: linked };
    this.#linkPatch = { ...this.#linkPatch, [group]: linked };
  }

  /** Every control back to the default its bindings declared. */
  resetControls(): void {
    for (const [alias, domain] of Object.entries(this.#domains)) this.#pending.set(alias, domain.default);
  }

  /** A pose recipe. Named channels are set; everything else keeps the value it had. */
  applyRecipe(name: string): void {
    const recipe = RECIPES[name];
    if (recipe === undefined) throw new Error(`no pose recipe is called '${name}'`);
    for (const [alias, value] of Object.entries(recipe)) this.setControl(alias, value);
  }

  /**
   * Move the camera to another of the stage's vantages.
   *
   * This is the capture hook, and it is the whole reason the framing is a function rather than a
   * block in `enter`: a look has to be seen from more than one angle, and the alternative is a
   * camera controller in a sample whose subject is a face and whose job is the rig.
   */
  look(vantage: VantageName): void {
    this.#face?.setVantage(VANTAGES[vantage]);
  }

  /** Put the camera back on the face, from the panel's button or the `frame` key. */
  frameFace(): void {
    this.#face?.frame();
  }

  override enter(ctx: LabCtx): void {
    ctx.add(ctx.camera);
    const human = this.#human;
    if (human === undefined) return;
    const camera = ctx.camera as PerspectiveCamera;
    this.#camera = camera;
    // **Three allocates no shadow map until something asks for one, and nothing does.** The
    // `WebGPURenderer` default is `shadowMap.enabled = false` and the engine only turns it on for
    // its own daylight rig, so `key.castShadow` in `setupStage` is a request that goes unanswered
    // until the game makes it here — which is why the rig produced a face with no nose shadow and
    // no shadow in the eye sockets, and looked flatter than its own texture set can carry.
    // `ctx.renderer` is the framework's wrapper and `.raw` is the three renderer behind it, which is
    // the documented route (`create-threenative/agent-docs/references/visual-baseline.md`).
    const raw = ctx.renderer.raw as { shadowMap?: { enabled: boolean } };
    if (raw.shadowMap === undefined)
      throw new Error("the running renderer exposes no shadowMap; the key light's cast shadow is dead");
    raw.shadowMap.enabled = true;
    // Framed first: the look replaces the very material names the framing reads its eyes from.
    const framing = measureFraming(camera, human.root);
    const visible = frameFace(camera, human.root);
    setupStage(ctx.scene, subjectRadius(human.root), framing.centre);
    applySpecimenMaterials(human.root, this.#maps);
    this.#addStrands(ctx, human.root);
    if (this.#shirt !== undefined) this.#addShirt(ctx, this.#shirt);
    this.#face = new FaceCamera(camera, framing, VANTAGES.front);
    // Sized once, against the frame this was framed in, and after the look, because the lash cards
    // are found by the material name the look gives them. It is a property of the model rather than
    // of the camera, so a later `look` moves the camera and leaves the cards alone.
    swayLashes(human.root, visible);
    ctx.add(human.root);
    this.#jaw = findByName(human.root, "FACIAL_C_Jaw");
    if (this.#jaw !== undefined) {
      const { position, quaternion, scale } = this.#jaw;
      this.#jawRest = [
        position.x, position.y, position.z,
        quaternion.x, quaternion.y, quaternion.z, quaternion.w,
        scale.x, scale.y, scale.z,
      ];
    }
    this.#readMorph = morphReader(human.root);
    human.update();
    // **Last, after everything is in the scene.** TRAA is a temporal filter over a scene pass: the
    // chain takes over the world render, so anything added to `ctx.scene` after this point is
    // absent from both the frame and the velocity buffer, and the strands would resolve against a
    // history of a different head. This is also the fail-closed spot — the chain refuses
    // rather than no-op'ing if it cannot provision velocity, and that refusal is a thrown error
    // here rather than a portrait that quietly stayed noisy.
    installTemporalAA(
      ctx.renderer as unknown as Parameters<typeof installTemporalAA>[0],
      ctx.scene,
      camera,
    );

    // The one place a rendered frame writes the rig. Slider traffic is coalesced into a single
    // `setControls` however many events the UI sent since the last draw, and the probes are read
    // back off the Three.js objects afterwards — not off the numbers the UI sent.
    ctx.beforeRender(() => {
      // The camera is read here rather than in `update` because this is the one callback that runs
      // once per *drawn* frame, and a camera posed on a frame the renderer skipped is a camera that
      // lurches on the next one.
      const face = this.#face;
      if (face !== undefined) {
        const input = ctx.input;
        const shift = input.raw.keys.has("ShiftLeft") || input.raw.keys.has("ShiftRight");
        const drag = input.vector("orbit");
        // `pointerRelative` reports raw movement whether or not a button is down (it exists for
        // pointer-lock mouse-look), so a drag is movement *while* its button is held.
        if ((drag.x !== 0 || drag.y !== 0) && input.pressed("orbit")) {
          // Shift turns the left button into a pan, which is the modifier every 3D tool uses for it and
          // the only one that fits a panel already covering a third of the window.
          if (input.pressed("pan") || shift) face.pan(drag.x, drag.y);
          else face.orbit(drag.x, drag.y);
        }
        const pan = input.vector("pan");
        if ((pan.x !== 0 || pan.y !== 0) && input.pressed("pan")) face.pan(pan.x, pan.y);
        const zoom = input.axis("zoom");
        if (zoom !== 0) face.zoom(zoom);
        if (input.justPressed("frame")) face.frame();
        face.update(performance.now());
      }
      if (Object.keys(this.#linkPatch).length > 0) {
        const links = this.#linkPatch;
        this.#linkPatch = {};
        ctx.state.set((state) => ({ linked: { ...state.linked, ...links } }));
      }
      let applied: Record<string, number> | undefined;
      if (this.#pending.size > 0) {
        applied = Object.fromEntries(this.#pending);
        human.setControls(applied);
        this.#pending.clear();
      }
      const started = performance.now();
      human.update();
      const evaluationMs = performance.now() - started;
      this.#followBrows();
      this.#frames += 1;
      const jaw = this.#jaw;
      const jawDelta = this.#jointDelta(jaw);
      ctx.state.set({
        // The sliders are a view of the published vector, so the value the rig was actually
        // given has to be published back. Without this the panel keeps showing the neutral it
        // started from while the face moves, and a keyboard step has nothing to step from.
        ...(applied === undefined
          ? {}
          : { controls: (this.#controls = { ...this.#controls, ...applied }) }),
        evaluationMs,
        frames: this.#frames,
        fps: ctx.fps,
        strands: this.#strandMesh?.strandCount ?? 0,
        probeJawJoint: jawDelta,
        probeJawMorph: this.#readMorph(PROBES.jaw),
        probeBlinkMorphLeft: this.#readMorph(PROBES.blinkLeft),
        probeBlinkMorphRight: this.#readMorph(PROBES.blinkRight),
        probeSmileMorphLeft: this.#readMorph(PROBES.smileLeft),
      });
    });
  }

  /**
   * How far one joint's local transform has moved from its exported rest transform.
   *
   * All ten components, not the translation alone: this rig opens the jaw by rotating
   * `FACIAL_C_Jaw` almost entirely, so a position-only probe would report a still face.
   */
  #jointDelta(node: Object3D | undefined): number {
    if (node === undefined || this.#jawRest.length !== 10) return 0;
    const { position, quaternion, scale } = node;
    const now = [
      position.x, position.y, position.z,
      quaternion.x, quaternion.y, quaternion.z, quaternion.w,
      scale.x, scale.y, scale.z,
    ];
    let worst = 0;
    for (let index = 0; index < 10; index += 1)
      worst = Math.max(worst, Math.abs((now[index] as number) - (this.#jawRest[index] as number)));
    return worst;
  }

  /**
   * The groom as strands: the hair hung off the head bone, and the brows hung off the face mesh
   * itself so each strand can ride its root's skin (`browFollow`). Neither is `ctx.add`ed:
   * `Object3D.add` reparents, and being a descendant of the root `ctx.add` registers is what puts
   * them in the render list.
   */
  #addStrands(ctx: LabCtx, root: Object3D): void {
    const hair = this.#hairStrands;
    const brows = this.#browStrands;
    const skin = this.#browSkin;
    if (hair === undefined || brows === undefined || skin === undefined) return;
    const { lights, ambient } = stageLights(ctx.scene);
    const mesh = new StrandMesh(hair, {
      shade: hairShading(lights, ambient, HAIR_LOOK),
      widthScale: HAIR_LOOK.widthScale,
    });
    mesh.name = "hair-strands";
    attachToHead(findByName(root, "head"), mesh);
    this.#strandMesh = mesh;
    const face = headSkin(root);
    const browMesh = new StrandMesh(brows, {
      shade: hairShading(lights, ambient, BROW_LOOK),
      widthScale: BROW_LOOK.widthScale,
      // The groom's floor is flat, which is right for a fibre of one gauge; a brow's authored widths
      // taper to nothing, and a flat floor holds every tip at a whole pixel — a fringe of hard dots
      // standing past the arch. `tipTaper: 0` lets the floor follow the taper, so a tip narrows with
      // the fibre that made it. The hair above keeps the default.
      tipTaper: 0,
    });
    browMesh.name = "brow-strands";
    face.add(browMesh);
    this.#followBrows = browFollow(face, browMesh, skin);
  }

  /** How many hair strands are drawn: the strand-count LOD. */
  setStrandCount(count: number): void {
    this.#strandMesh?.setStrandCount(count);
  }

  /**
   * The shirt, added to the scene at identity and given this sample's look.
   *
   * No `attachToHead`, and that is the whole placement: the shirt hangs on `spine_05` and
   * `clavicle_l/r` in its own skin and its skeleton is the specimen's, joint for joint, to five
   * decimals — so it belongs in the scene's own space, and parenting it under the head bone would
   * rotate a shirt with a head. It casts no shadow: at this framing it is the bottom of the frame,
   * below the key's shadow camera's near plane, and the collar's own shadow is the one thing about
   * it the face would notice if it were missing — the neck's shadow onto the fabric is the key's
   * own geometry and comes for free.
   */
  #addShirt(ctx: LabCtx, shirt: Group): void {
    shirt.name = "shirt";
    const look = shirtLook(this.#maps);
    shirt.traverse((object) => {
      const mesh = object as Mesh;
      if (mesh.isMesh !== true) return;
      // The export's COLOR_0 is the same packed Unreal channel the face's is, and it is nearly
      // black; the shirt look states its own colour and must not be tinted by it.
      mesh.material = look;
      mesh.receiveShadow = true;
    });
    ctx.add(shirt);
  }

  override exit(): void {
    disposeTemporalAA();
    this.#human?.dispose();
    this.#human = undefined;
    this.#shirt = undefined;
    this.#strandMesh = undefined;
    this.#followBrows = () => undefined;
    this.#face = undefined;
  }
}

/** The face mesh: the skinned mesh carrying the most vertices (the brow cards carry the same targets). */
function headSkin(root: Object3D): SkinnedMesh {
  let best: SkinnedMesh | undefined;
  root.traverse((object) => {
    const mesh = object as SkinnedMesh;
    if (mesh.isSkinnedMesh !== true) return;
    const count = mesh.geometry.getAttribute("position").count;
    if (best === undefined || count > best.geometry.getAttribute("position").count) best = mesh;
  });
  if (best === undefined) throw new Error("the specimen carries no skinned face mesh for the brows to ride");
  return best;
}

/** A binary file from `content/`, by the loader's own candidate URLs (the no-manifest route). */
async function readBytes(ctx: LabCtx, path: string): Promise<ArrayBuffer> {
  const failures: string[] = [];
  for (const url of await ctx.assets.resolve(path)) {
    const response = await fetch(url);
    if (response.ok) return response.arrayBuffer();
    failures.push(`${url} (${response.status})`);
  }
  throw new Error(`TN_ASSETS_UNRESOLVED ${path}: ${failures.join("; ")}`);
}

function findByName(root: Object3D, name: string): Object3D | undefined {
  let found: Object3D | undefined;
  root.traverse((object) => {
    if (found === undefined && object.name === name) found = object;
  });
  return found;
}

/**
 * The strongest influence the specimen applied to any morph target of one DNA channel.
 *
 * The export names a target `<dnaMesh>__<channel>` and one channel can own a target on more than
 * one mesh, so the answer is the largest of them. The dictionary is resolved once here; a frame
 * costs one array read per probed channel.
 */
function morphReader(root: Object3D): (channel: string) => number {
  const lookup = new Map<string, { index: number; mesh: Mesh }[]>();
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (mesh.isMesh !== true) return;
    for (const [name, index] of Object.entries(mesh.morphTargetDictionary ?? {})) {
      const at = name.indexOf("__");
      if (at < 0) continue;
      const channel = name.slice(at + 2);
      const entries = lookup.get(channel) ?? [];
      entries.push({ mesh, index });
      lookup.set(channel, entries);
    }
  });
  return (channel) => {
    let best = 0;
    for (const entry of lookup.get(channel) ?? []) {
      const influence = entry.mesh.morphTargetInfluences?.[entry.index];
      if (influence !== undefined && Math.abs(influence) > Math.abs(best)) best = influence;
    }
    return best;
  };
}
