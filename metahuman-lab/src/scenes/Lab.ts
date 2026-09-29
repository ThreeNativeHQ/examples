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
  wrinkleTextures,
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
import { BROW_LOOK, bindWrinkles, HAIR_LOOK, type IWrinkleTable } from "../render/look.js";
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
import {
  BLINK_CHANNELS,
  DEMO_DURATION,
  GAZE_CHANNELS,
  PRESETS,
  demoAt,
  profileHash,
  rampStep,
  readPose,
  resolve,
  withPreset,
  writePose,
  type PresetName,
  type IVector,
} from "../expression.js";
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
/** The wrinkle regions `tools/prepare.mjs --wrinkles` packed, by tile and channel. */
const WRINKLES = "content/wrinkles.json";

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

/** The joint and morph channels a playtest samples, named as the DNA carries them. */
const PROBES = {
  jaw: "jaw_open",
  blinkLeft: "eye_blink_L",
  blinkRight: "eye_blink_R",
  smileLeft: "mouth_cornerPull_left",
} as const;

/** Six decimals is well inside float32 noise and readable in a failure report. */
const round = (value: number): number => Math.round(value * 1e6) / 1e6;

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
    preset: "neutral",
    intensity: 1,
    transition: 0.25,
    blinkAuto: false,
    gazeAuto: false,
    playing: false,
    demoEngaged: false,
    demoTime: 0,
    demoDuration: DEMO_DURATION,
    demoSample: { t: 0, jawJoint: 0, jawMorph: 0, smileMorphLeft: 0, blinkMorphLeft: 0 },
    pose: "",
    poseStatus: "",
    backend: "",
    openRigLogic: "",
    lod: 0,
    lodVertices: 0,
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
    probeWrinkles: [0, 0, 0],
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
  #wrinkleTable: IWrinkleTable | undefined;
  /** Feeds the skin's wrinkle weights from the rig's animated maps after every evaluation. */
  #writeWrinkles: (values: ArrayLike<number>) => void = () => undefined;
  #wrinklesApplied: () => readonly [number, number, number] = () => [0, 0, 0];
  #face: FaceCamera | undefined;
  #camera: PerspectiveCamera | undefined;
  #domains: Readonly<Record<string, IDomain>> = {};
  /** What the sliders said: the base vector a face is at when nothing else is acting. */
  #manual: Record<string, number> = {};
  /** The declared neutral, which `reset` restores and the neutral recipe is made of. */
  #defaults: IVector = {};
  #pairs: Readonly<Record<string, readonly [number, number]>> = {};
  #preset: PresetName | "" = "neutral";
  #intensity = 1;
  #transition = 0.25;
  #blinkAuto = false;
  #gazeAuto = false;
  /** Playback running; `#demoEngaged` is the wider claim that the sequence still owns the base. */
  #playing = false;
  #demoEngaged = false;
  #demoTime = 0;
  /**
   * The face's own clock, in simulated seconds since `enter`.
   *
   * **The engine's fixed step, not `performance.now()`.** Everything the face animates on — the
   * transition ramp, the demo playback, the blink and gaze curves — is a pure function of this
   * number, and a playtest advances the simulation by exact ticks with the wall clock frozen. On the
   * wall clock a 0.25 s transition lands wherever the host's frame rate put it: a scenario that
   * waited 40 ticks after a preset read the pose 60% of the way there and recorded *that* as the
   * expected value, so the same scenario passed on one machine and failed on the next. On the fixed
   * step the ramp is a function of the tick count, which is what makes "the same time gives the same
   * pose" a property of the code rather than of the host.
   */
  #simTime = 0;
  #clock: (() => void) & { cancel(): void } | undefined;
  /** What the rig was last given, so a frame that changes nothing sends nothing. */
  #display: Record<string, number> = {};
  #sent: Record<string, number> = {};
  /** A transition in flight: from where the face was, and how far through it is. */
  #rampFrom: IVector = {};
  #ramping = false;
  #rampElapsed = 0;
  /** `#simTime` at the last drawn frame, so a transition can be measured in simulated seconds. */
  #drawnTime = 0;
  /** The specimen identity a saved pose is pinned to, read from the same sidecar the load used. */
  #specimen = "";
  #profile = "";
  #poseText = "";
  #poseStatus = "";
  /** Kept from `enter`, because a model change is publishable from any intent handler. */
  #ctx: LabCtx | undefined;
  /** Aliases the UI changed since the last rendered frame; coalesced into one `setControls`. */
  readonly #pending = new Map<string, number>();
  /** The last published vector, so a frame that changes one control keeps the other 32. */
  #controls: Readonly<Record<string, number>> = {};
  /** The last vector the tick published to the UI, so a tick that changed nothing publishes nothing. */
  #published: Record<string, number> = {};
  /** The last probe set, so a tick's publish can carry the demo's time without losing the face's. */
  #demoSample: NonNullable<GameState["demoSample"]> = {
    t: 0, jawJoint: 0, jawMorph: 0, smileMorphLeft: 0, blinkMorphLeft: 0,
  };
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
      this.#wrinkleTable = JSON.parse(new TextDecoder().decode(await readBytes(ctx, WRINKLES))) as IWrinkleTable;
      for (const group of CONTROL_GROUPS) {
        for (const row of group.rows) {
          this.#mirror.set(row.left, { group: group.id, other: row.right });
          if (row.right !== undefined) this.#mirror.set(row.right, { group: group.id, other: row.left });
        }
      }
      this.#domains = Object.fromEntries(
        human.controls.map((control) => [control.alias, { min: control.min, max: control.max, default: control.default }]),
      );
      this.#pairs = Object.fromEntries(
        human.controls.map((control) => [control.alias, [control.min, control.max] as const]),
      );
      this.#defaults = Object.fromEntries(human.controls.map((control) => [control.alias, control.default]));
      // The base vector starts as the declared neutral, alias for alias: a control the panel has not
      // touched still has to be published, or `state.controls` grows an alias only once something
      // writes it and a playtest asserting an untouched channel reads `undefined`.
      this.#manual = { ...this.#defaults };
      // The identity a pose is pinned to. It is read off the sidecar the handle just validated,
      // which is the only copy of it the game has: `hashes.dna` is the specimen, and the control
      // table's own hash is the profile those values were declared against.
      const sidecar = JSON.parse(new TextDecoder().decode(await readBytes(ctx, BINDINGS))) as {
        hashes: { dna: string };
        controls: Parameters<typeof profileHash>[0];
      };
      this.#specimen = sidecar.hashes.dna;
      this.#profile = profileHash(sidecar.controls);
      const diagnostics = human.diagnostics();
      ctx.state.set({
        phase: "ready",
        stage: "ready",
        controls: this.#controls = this.#display = { ...this.#defaults },
        domains: Object.fromEntries(
          human.controls.map((control) => [control.alias, [control.min, control.max] as const]),
        ),
        backend: diagnostics.backend,
        openRigLogic: diagnostics.openRigLogic,
        lod: diagnostics.lod,
        lodVertices: visibleVertices(human.root),
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
   *
   * A manual edit also does the two things the PRD's precedence says it does — it stops playback,
   * and it switches off whichever automation owns this channel. The face itself moves at once:
   * a slider under a transition is a slider that lags the hand.
   */
  setControl(alias: string, value: number): void {
    const domain = this.#domains[alias];
    if (domain === undefined) throw new Error(`no control is declared as '${alias}'`);
    if (!Number.isFinite(value)) throw new Error(`${alias} was given ${String(value)}`);
    if (value < domain.min || value > domain.max)
      throw new Error(`${alias} was given ${value}, outside [${domain.min}, ${domain.max}]`);
    this.#pending.set(alias, value);
    this.#mirrorTo(alias, value);
    this.#playing = false;
    this.#demoEngaged = false;
    if (BLINK_CHANNELS.includes(alias as (typeof BLINK_CHANNELS)[number])) this.#blinkAuto = false;
    if (GAZE_CHANNELS.includes(alias as (typeof GAZE_CHANNELS)[number])) this.#gazeAuto = false;
    // Published, because the precedence is only real if the panel can see it: without this the play
    // button stays lit and the blink checkbox stays ticked after a slider has taken the face back,
    // and the scenario that proves the precedence reads a lie.
    this.#publishModel();
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

  /**
   * Reset: automation and playback off, the neutral recipe chosen, and every channel back to the
   * value its bindings declared — not to "whatever was there before the first expression".
   *
   * Five lines, because choosing the neutral recipe *is* the reset: `withPreset` writes the declared
   * defaults over the whole vector, so there is no second spelling of "neutral" that can drift from
   * the first.
   */
  resetControls(): void {
    this.#pending.clear();
    this.#demoTime = 0;
    this.#blinkAuto = false;
    this.#gazeAuto = false;
    this.setPreset("neutral", 1);
  }

  /**
   * A recipe, with the intensity it reaches at. Choosing one is a decision, so it stops playback.
   *
   * The recipe is written into the manual vector rather than kept as a layer `resolve` re-applies —
   * see `withPreset` in `expression.ts`, which is where the reason lives in full.
   */
  setPreset(name: string, intensity = this.#intensity): void {
    if (!(name in PRESETS)) throw new Error(`no preset is called '${name}'`);
    this.#preset = name as PresetName;
    this.#intensity = Math.min(Math.max(intensity, 0), 1);
    this.#manual = withPreset(this.#manual, this.#preset, this.#intensity, this.#defaults);
    this.#playing = false;
    this.#demoEngaged = false;
    this.#beginTransition();
    this.#publishModel();
  }

  setIntensity(value: number): void {
    if (!Number.isFinite(value)) throw new Error(`intensity was given ${String(value)}`);
    this.setPreset(this.#preset, value);
  }

  /** Seconds a change takes to arrive. Zero is a cut, and it applies from the next change. */
  setTransition(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error(`transition was given ${String(seconds)}`);
    this.#transition = seconds;
    this.#publishModel();
  }

  setAutomation(which: "blink" | "gaze", on: boolean): void {
    if (which === "blink") this.#blinkAuto = on;
    else this.#gazeAuto = on;
    this.#beginTransition();
    this.#publishModel();
  }

  playDemo(): void {
    // Choosing the sequence is a decision about the whole face, so it replaces the chosen recipe.
    this.#preset = "";
    this.#playing = true;
    this.#demoEngaged = true;
    this.#publishModel();
  }

  /**
   * Pause, which is not the same as stopping.
   *
   * The face stays on the pose it stopped at: the sequence still owns the base, it just is not
   * advancing. A slider, a recipe or reset takes the base back — that is the manual edit the PRD's
   * precedence calls for, and it is what makes pause a pause rather than a snap back to neutral.
   */
  pauseDemo(): void {
    this.#playing = false;
    this.#publishModel();
  }

  /**
   * Scrub to a time. A cut, deliberately: the pose at `t` is the pose at `t` however the face got
   * there, so a transition here would be the one thing that made the answer depend on history.
   */
  scrubDemo(seconds: number): void {
    if (!Number.isFinite(seconds)) throw new Error(`scrub was given ${String(seconds)}`);
    this.#demoTime = Math.min(Math.max(seconds, 0), DEMO_DURATION);
    this.#playing = false;
    this.#demoEngaged = true;
    this.#ramping = false;
    this.#publishModel();
  }

  /**
   * Switch the source LOD. The handle evaluates the current controls before the replacement mesh
   * is shown, so the expression is carried across rather than flashed away; the vertex count is
   * re-measured off what is now visible so diagnostics report a fact.
   */
  setLod(lod: number): void {
    this.#human?.setLod(lod);
    this.#publishModel();
  }

  /** Write the pose the rig is actually being given into the text panel. */
  savePose(): void {
    this.#poseText = writePose(this.#specimen, this.#profile, this.#display);
    this.#poseStatus = `saved ${Object.keys(this.#display).length} controls for specimen ${this.#specimen.slice(0, 12)}…`;
    this.#publishModel();
  }

  /**
   * Load a pose from the panel, or say why not. A pose from another specimen, another profile, an
   * older version, or with a value this head does not declare is refused with the reason.
   */
  loadPose(text: string): void {
    const controls = readPose(text, { specimen: this.#specimen, profile: this.#profile, domains: this.#pairs });
    this.#manual = { ...this.#defaults, ...controls };
    this.#playing = false;
    this.#demoEngaged = false;
    this.#beginTransition();
    this.#poseStatus = `loaded ${Object.keys(controls).length} controls`;
    this.#publishModel();
  }

  clearPose(): void {
    this.#poseText = "";
    this.#poseStatus = "";
    this.#publishModel();
  }

  /**
   * The effective vector for this tick: playback's base if it is engaged, then the manual vector,
   * then each enabled automation, brought along by the transition if one is in flight.
   *
   * A pure read of state into `#display`, called once per fixed step, so a transition is measured in
   * simulated seconds and a playtest's exact tick count decides where the face is.
   */
  #resolve(): void {
    this.#rampElapsed += this.#simTime - this.#drawnTime;
    this.#drawnTime = this.#simTime;
    const target = resolve({
      manual: this.#manual,
      demo: this.#demoEngaged ? demoAt(this.#demoTime) : undefined,
      blink: this.#blinkAuto,
      gaze: this.#gazeAuto,
      t: this.#simTime,
      domains: this.#pairs,
    });
    if (!this.#ramping) {
      this.#display = target;
      return;
    }
    const step = rampStep(this.#rampElapsed, this.#transition);
    const from = this.#rampFrom;
    const display: Record<string, number> = {};
    for (const [alias, value] of Object.entries(target))
      display[alias] = (from[alias] ?? 0) + (value - (from[alias] ?? 0)) * step;
    this.#display = display;
    if (step >= 1) this.#ramping = false;
  }

  /** Start a transition from wherever the face is now, if the transition is longer than nothing. */
  #beginTransition(): void {
    this.#ramping = this.#transition > 0;
    this.#rampFrom = { ...this.#display };
    this.#rampElapsed = 0;
  }

  /** The model fields the panel renders, published together so they cannot disagree by a frame. */
  #publishModel(): void {
    this.#ctx?.state.set({
      preset: this.#preset,
      intensity: this.#intensity,
      transition: this.#transition,
      blinkAuto: this.#blinkAuto,
      gazeAuto: this.#gazeAuto,
      playing: this.#playing,
      demoEngaged: this.#demoEngaged,
      demoTime: Math.round(this.#demoTime * 1000) / 1000,
      demoDuration: DEMO_DURATION,
      pose: this.#poseText,
      poseStatus: this.#poseStatus,
      lod: this.#human?.diagnostics().lod ?? 0,
      lodVertices: visibleVertices(this.#human?.root),
    });
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
    this.#ctx = ctx;
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
    // The wrinkle maps are the one part of the look the rig drives: each region's weight is an
    // animated-map output, written into the skin's uniforms after every evaluation below.
    const wrinkles =
      this.#wrinkleTable === undefined
        ? undefined
        : bindWrinkles(wrinkleTextures(this.#maps), this.#wrinkleTable, human.animatedMapNames());
    this.#writeWrinkles = wrinkles?.write ?? (() => undefined);
    this.#wrinklesApplied = wrinkles?.applied ?? (() => [0, 0, 0]);
    applySpecimenMaterials(human.root, this.#maps, wrinkles?.wrinkles);
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

    // The one place a rendered frame writes the rig. The whole effective vector is resolved here —
    // demo base, then the recipe at its intensity, then each automation over the channels it owns
    // — and it reaches the handle as a single `setControls` however many events the UI sent since
    // the last draw. The probes are read back off the Three.js objects afterwards, not off the
    // numbers the UI sent.
    // The face's clock, and the demo's own advance, on the engine's fixed step. Registered here so a
    // scene that never drew a frame still keeps time; see `#simTime` for why it is not the wall clock.
    this.#clock?.cancel();
    this.#simTime = 0;
    this.#drawnTime = 0;
    this.#clock = ctx.every((dt) => {
      this.#simTime += dt;
      if (this.#playing) {
        this.#demoTime += dt;
        if (this.#demoTime >= DEMO_DURATION) this.#demoTime -= DEMO_DURATION;
      }
      this.#resolve();
      // Published from the tick, and only when the vector actually moved. A playtest advances the
      // simulation in exact ticks and samples the state afterwards; a vector that was published once
      // per *drawn* frame is a vector the sampler can read a whole transition out of date, which is
      // how a scenario ends up recording "0.51 of 0.7" as the expected value. The rig itself is
      // still written once per drawn frame, in `beforeRender`, where the probes are read.
      if (sameVector(this.#display, this.#published)) return;
      this.#published = this.#display;
      this.#ctx?.state.set({
        controls: this.#controls = this.#display,
        demoSample: { ...this.#demoSample, t: Math.round(this.#demoTime * 1000) / 1000 },
      });
    });

    ctx.beforeRender(() => {
      // The wall clock, for the camera's damping only. Everything the face itself does is a function
      // of `#simTime`, which `ctx.every` advances once per fixed step.
      const now = performance.now() / 1000;
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
        face.update(now * 1000);
      }
      if (Object.keys(this.#linkPatch).length > 0) {
        const links = this.#linkPatch;
        this.#linkPatch = {};
        ctx.state.set((state) => ({ linked: { ...state.linked, ...links } }));
      }
      // Slider traffic lands in the manual vector and is read from there, so a drag across twelve
      // sliders is twelve writes to one vector rather than twelve rig writes.
      if (this.#pending.size > 0) {
        for (const [alias, value] of this.#pending) this.#manual[alias] = value;
        this.#pending.clear();
      }
      if (Object.keys(this.#display).length > 0 && !sameVector(this.#display, this.#sent)) {
        this.#sent = this.#display;
        human.setControls(this.#display);
      }
      const started = performance.now();
      human.update();
      const evaluationMs = performance.now() - started;
      this.#writeWrinkles(human.animatedMaps());
      this.#followBrows();
      this.#frames += 1;
      // Rounded, like every other published measurement: a probe's job is to be asserted against, and
      // a float32 weight arriving as 0.8500000238418579 makes an exact comparison unreadable without
      // making it any stricter — 1e-6 is far inside the evaluator's own noise.
      const jawDelta = round(this.#jointDelta(this.#jaw));
      const jawMorph = round(this.#readMorph(PROBES.jaw));
      const blinkLeft = round(this.#readMorph(PROBES.blinkLeft));
      const smileLeft = round(this.#readMorph(PROBES.smileLeft));
      ctx.state.set({
        // The sliders are a view of the published vector, so the value the rig was actually
        // given has to be published back. Without this the panel keeps showing the neutral it
        // started from while the face moves, and a keyboard step has nothing to step from.
        evaluationMs,
        frames: this.#frames,
        fps: ctx.fps,
        strands: this.#strandMesh?.strandCount ?? 0,
        probeJawJoint: jawDelta,
        probeJawMorph: jawMorph,
        probeBlinkMorphLeft: blinkLeft,
        probeBlinkMorphRight: round(this.#readMorph(PROBES.blinkRight)),
        probeSmileMorphLeft: smileLeft,
        probeWrinkles: this.#wrinklesApplied().map(round),
        demoSample: (this.#demoSample = {
          ...this.#demoSample,
          t: Math.round(this.#demoTime * 1000) / 1000,
          jawJoint: jawDelta,
          jawMorph,
          smileMorphLeft: smileLeft,
          blinkMorphLeft: blinkLeft,
        }),
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
      // And the root emerges from its stain as a hairline rather than starting at full width.
      rootFade: 0.35,
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
    this.#clock?.cancel();
    this.#clock = undefined;
    this.#ctx = undefined;
    this.#human?.dispose();
    this.#human = undefined;
    this.#shirt = undefined;
    this.#strandMesh = undefined;
    this.#followBrows = () => undefined;
    this.#writeWrinkles = () => undefined;
    this.#face = undefined;
  }
}

/** Two vectors worth comparing: same aliases, same values, so there is nothing to send. */
function sameVector(a: Record<string, number>, b: Record<string, number>): boolean {
  const before = Object.entries(b);
  return before.length === Object.keys(a).length && before.every(([alias, value]) => a[alias] === value);
}

/**
 * Vertices in the LOD mesh set that is actually drawn.
 *
 * Skinned meshes only: every LOD mesh the container carries rides the skeleton, while the groom is
 * a `Mesh` of ribbons parented into the same graph and would otherwise be counted as part of the
 * level it is not part of. Counted off the graph rather than read from a constant, so the
 * diagnostics row names the level on screen — LOD0's 38 911 and LOD1's 19 269 are different numbers
 * for the same face, and saying which one is showing is the cheapest part of the LOD proof.
 */
function visibleVertices(root: Object3D | undefined): number {
  if (root === undefined) return 0;
  let total = 0;
  root.traverse((object) => {
    const mesh = object as SkinnedMesh;
    if (mesh.isSkinnedMesh !== true || mesh.visible !== true) return;
    total += mesh.geometry.getAttribute("position").count;
  });
  return total;
}

/** The face mesh: the skinned mesh carrying the most vertices (the brow cards carry the same targets). */function headSkin(root: Object3D): SkinnedMesh {
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
