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
  /** `diagnostics()` from the handle, published verbatim once the rig is live. */
  backend: string;
  openRigLogic: string;
  lod: number;
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
  /** True once the UI layer has rendered and published its interactive rectangles. */
  uiReady: boolean;
};
