/**
 * What the lab publishes, and what a playtest reads.
 *
 * Every value is JSON-safe because the playtest bridge clones this object as an observation:
 * a `Map`, a class instance or a function here is a bridge error rather than a value.
 *
 * `probe*` are not decoration. They are the sampled joint and morph values the specimen's rig
 * actually produced and the binding actually applied — read off the Three.js objects after
 * `human.update()`, not off the numbers the UI sent. A playtest that only proved the sliders
 * moved would prove the transport, not the face.
 */
export type LabPhase = "error" | "loading" | "missing-content" | "ready";

/** One sampled frame of the rig, rounded so a JSON comparison is readable in a failure report. */
export interface IDemoSample {
  readonly t: number;
  readonly jawJoint: number;
  readonly jawMorph: number;
  readonly smileMorphLeft: number;
  readonly blinkMorphLeft: number;
}

export type GameState = {
  /** `loading` until the rig is bound, then `ready`, or one of the two refusals. */
  phase: LabPhase;
  /** The asset or initialisation step on screen, so a stall names itself. */
  stage: string;
  /** Bytes finished over bytes known, when the loader can tell. */
  loadedBytes: number;
  knownBytes: number;
  /** Set when `phase` is `error` or `missing-content`. */
  message: string;
  /** The game's authoritative control vector, by declared alias. */
  controls: Record<string, number>;
  /** Each declared channel's legal range, `[min, max]`, straight from the specimen's sidecar. */
  domains: Record<string, readonly [number, number]>;
  /** One link flag per group, so a left/right pair can be driven together or apart. */
  linked: Record<string, boolean>;
  /** The recipe the panel last chose, or `""` for none. */
  preset: string;
  /** 0..1, how far the chosen recipe reaches. */
  intensity: number;
  /** Seconds a change takes to arrive. Zero is a cut. */
  transition: number;
  /** Procedural blinking and procedural gaze, each owning only the channels it names. */
  blinkAuto: boolean;
  gazeAuto: boolean;
  /** Whether the demonstration sequence is running, and where it is. */
  playing: boolean;
  /** Whether it still owns the base vector — true while paused, false once anything takes over. */
  demoEngaged: boolean;
  demoTime: number;
  demoDuration: number;
  /**
   * What the rig was actually given and produced at the current demo time, read off the Three.js
   * objects like every other probe. This is the value A4 compares across two pose histories.
   */
  demoSample: IDemoSample;
  /** The pose text panel, and what the last save or load said. */
  pose: string;
  poseStatus: string;
  /** `diagnostics()` from the handle, published verbatim once the rig is live. */
  backend: string;
  openRigLogic: string;
  lod: number;
  /** Vertices in the visible LOD's mesh set, so a switch is a measurement rather than a flag. */
  lodVertices: number;
  joints: number;
  blendShapes: number;
  animatedMaps: number;
  /** Milliseconds spent in the last rig evaluation and output application. */
  evaluationMs: number;
  /** Frames the scene has presented, so a reader can tell a stall from a slow start. */
  frames: number;
  /** Presented frames per second, from the engine, so the cost row reports a rate and not a guess. */
  fps: number;
  /** Hair strands drawn this frame (the strand-count LOD). */
  strands: number;
  /** Sampled from the rig's joint output as applied to the jaw node. */
  probeJawJoint: number;
  /** Sampled from the applied morph influence of `jaw_open`. */
  probeJawMorph: number;
  /** Sampled from the applied morph influence of `eye_blink_L` / `eye_blink_R`. */
  probeBlinkMorphLeft: number;
  probeBlinkMorphRight: number;
  /** Sampled from the applied morph influence of `mouth_cornerPull_left`. */
  probeSmileMorphLeft: number;
  /**
   * The strongest weight each wrinkle map (WM1..3) was given this frame, read back off the skin
   * shader's own uniforms after the rig's animated maps were written into them.
   */
  probeWrinkles: number[];
  /** True once the UI layer has rendered and published its interactive rectangles. */
  uiReady: boolean;
};
