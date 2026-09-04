/**
 * The animals of the wood, as data.
 *
 * Every number here is a look or a feel decision, so it lives in the game and not in any shared
 * helper: the entity machinery (`Animal.ts`) reads a spec and would run a dragon or a duck
 * unchanged. Sizes are real-world, because the GLBs arrive at wildly different scales and
 * normalising by the model's own world-space bounds is what keeps a fox smaller than a stag
 * without anyone hand-tuning per-file scale factors. `length` is the full nose-to-tail-tip
 * extent, which is what the world-space span measures — a body-only number normalises the
 * animal to half size.
 *
 * These are the PROTOFACTOR Animal Variety Pack rigs (Fab 2dd7964c), imported with their own
 * ActorX clips; the clip names below are the pack's, and `Animal` audits at load that each one
 * actually binds.
 */

/** The clips an animal's state machine needs, named by what they mean, not what they are called. */
export interface AnimalClipMap {
  readonly idle: string;
  /** A second idle, played at random so a field of animals does not synchronise. */
  readonly idleAlt: string;
  /** Head-low, wary: between grazing and bolting. */
  readonly alert: string;
  readonly graze: string;
  readonly walk: string;
  readonly run: string;
  readonly attack: string;
  readonly die: string;
  readonly hitReact: string;
  readonly jump: string;
}

/**
 * Clip names exactly as the importer wrote them: the ActorX package name, `ANIM_<Animal>_` prefix
 * and all. The state machine loops idle/graze/walk/run; the one-shot clips play through. WOLF
 * spreads FOX and DOE spreads STAG — same rig family, same clip tails, different prefix.
 */
const FOX_CLIPS: AnimalClipMap = {
  idle: "ANIM_Fox_IdleBreathe",
  idleAlt: "ANIM_Fox_IdleLookAround",
  alert: "ANIM_Fox_IdleAggressive",
  graze: "ANIM_Fox_IdleLookAround",
  walk: "ANIM_Fox_Walk",
  run: "ANIM_Fox_Run",
  attack: "ANIM_Fox_Bite",
  die: "ANIM_Fox_Death",
  hitReact: "ANIM_Fox_GetHitFront",
  jump: "ANIM_Fox_JumpBite",
};

/**
 * The wolf is the fox's rig family, but the clips live in the wolf's OWN pack and carry its own
 * prefix. Spreading `FOX_CLIPS` and overriding three names left seven `ANIM_Fox_*` names that
 * `SK_Wolf.glb` does not contain, so the wolf bound one clip out of ten and stood in bind pose.
 * Same for the doe below. The audit reports it (`MISSING`); nothing was calling the audit.
 */
const WOLF_CLIPS: AnimalClipMap = {
  idle: "ANIM_Wolf_IdleBreathe",
  idleAlt: "ANIM_Wolf_IdleLookAround",
  alert: "ANIM_Wolf_IdleAggressive",
  graze: "ANIM_Wolf_Howl",
  walk: "ANIM_Wolf_Walk",
  run: "ANIM_Wolf_Run",
  attack: "ANIM_Wolf_Bite",
  die: "ANIM_Wolf_Death",
  hitReact: "ANIM_Wolf_GetHitLeft",
  jump: "ANIM_Wolf_JumpBite",
};

const STAG_CLIPS: AnimalClipMap = {
  idle: "ANIM_DeerStag_IdleBreathe",
  idleAlt: "ANIM_DeerStag_IdleLookAround",
  alert: "ANIM_DeerStag_IdleLookAround",
  graze: "ANIM_DeerStag_IdleGraze",
  walk: "ANIM_DeerStag_Walk",
  run: "ANIM_DeerStag_Run",
  attack: "ANIM_DeerStag_AntlersAttack",
  die: "ANIM_DeerStag_Death",
  hitReact: "ANIM_DeerStag_GetHit",
  jump: "ANIM_DeerStag_AntlersComboAttack",
};

const DOE_CLIPS: AnimalClipMap = {
  idle: "ANIM_DeerDoe_IdleBreathe",
  idleAlt: "ANIM_DeerDoe_IdleLookAround",
  alert: "ANIM_DeerDoe_IdleLookAround",
  graze: "ANIM_DeerDoe_IdleGraze",
  walk: "ANIM_DeerDoe_Walk",
  run: "ANIM_DeerDoe_Run",
  attack: "ANIM_DeerDoe_GrazeOnce",
  die: "ANIM_DeerDoe_Death",
  hitReact: "ANIM_DeerDoe_GetHit",
  jump: "ANIM_DeerDoe_WalkGraze",
};

const PIG_CLIPS: AnimalClipMap = {
  idle: "ANIM_Pig_IdleBreathe",
  idleAlt: "ANIM_Pig_IdleLookAround",
  alert: "ANIM_Pig_IdleLookAround",
  graze: "ANIM_Pig_Chew",
  walk: "ANIM_Pig_Walk",
  run: "ANIM_Pig_Run",
  attack: "ANIM_Pig_attack",
  die: "ANIM_Pig_Death",
  hitReact: "ANIM_Pig_GetHit",
  jump: "ANIM_Pig_JumpAttack",
};

const CROW_CLIPS: AnimalClipMap = {
  idle: "ANIM_Crow_IdleLookAround",
  idleAlt: "ANIM_Crow_IdleScratchWing",
  alert: "ANIM_Crow_IdleLookAround",
  graze: "ANIM_Crow_EatSomething",
  walk: "ANIM_Crow_Walk",
  run: "ANIM_Crow_Hop",
  attack: "ANIM_Crow_FlyingAttack",
  die: "ANIM_Crow_DeathGrounded",
  hitReact: "ANIM_Crow_DeathHitTheGround",
  jump: "ANIM_Crow_TakeOff",
};

export interface AnimalSpec {
  /** Stable id used by placements, the HUD, and the DOM. */
  readonly id: string;
  /** The GLB file stem in the pack's import output (`SK_Fox`, not the species id). */
  readonly glb: string;
  readonly label: string;
  /**
   * Full nose-to-tail body length in metres; the loaded model is normalised to this.
   */
  readonly length: number;
  readonly clips: AnimalClipMap;
  /**
   * Metres per second on the walk.
   *
   * **Not tuned by eye — read off the clip.** `AnimationPlayer` re-times a cycle to the ground the
   * body covers, but only inside a 0.15x-3x band, and past the ceiling the rate is clamped rather
   * than reached: the legs cycle flat out under a body going a different speed, which is the
   * foot-slide a player actually sees. So the honest speed for a species is the one its own clip
   * was drawn for, which `player.stride.clipGroundSpeed` states in metres per second.
   *
   * `node tools/stride-gate.mjs` prints that number next to each speed here and fails when the
   * two are more than a gait apart. Change a speed and re-run it.
   */
  readonly walkSpeed: number;
  /**
   * Metres per second at a run. Same rule: the clip states the gait, and the gait states the speed.
   *
   * These "Run" clips are canters and lopes, not flat-out sprints — measured at 2.4-4.6 m/s. A real
   * stag tops 15 m/s in the open, and the pack has no clip for it; asking for one anyway is what
   * put every deer's legs at the 3x ceiling while it crossed the wood like a car.
   */
  readonly runSpeed: number;
  /** How close a threat may come before the animal bolts, in metres. */
  readonly fleeRadius: number;
  /**
   * Yaw added on top of the movement heading. The pack's models are authored facing +Z, so zero
   * should be right; the harness screenshot is what confirms it, and a species that arrives
   * backwards gets PI here rather than a hand-rotated GLB.
   */
  readonly yawOffset: number;
}

export const ANIMAL_SPECS: readonly AnimalSpec[] = [
  {
    id: "fox",
    glb: "SK_Fox",
    label: "Fox",
    length: 1.05,
    clips: FOX_CLIPS,
    // Clip stride: walk 0.54 m/s, run 2.37 m/s. A red fox walks 0.5-1.5 and lopes 3-5 through
    // cover; its 12 m/s sprint is open ground and a few seconds long, and no clip here shows it.
    walkSpeed: 0.9,
    runSpeed: 5,
    fleeRadius: 7,
    yawOffset: 0,
  },
  {
    id: "wolf",
    glb: "SK_Wolf",
    label: "Wolf",
    length: 1.55,
    clips: WOLF_CLIPS,
    // Clip stride: walk 0.73 m/s, run 2.84 m/s. A wolf's cruising trot is famously ~2.8 m/s, which
    // is what the run clip was drawn for; 6 is that trot pressed into a bolt.
    walkSpeed: 1.1,
    runSpeed: 6,
    fleeRadius: 5,
    yawOffset: 0,
  },
  {
    id: "stag",
    glb: "SK_DeerStag",
    label: "Stag",
    length: 2.1,
    clips: STAG_CLIPS,
    // Clip stride: walk 1.29 m/s, run 3.39 m/s. The walk clip was drawn for almost exactly this
    // speed, which is also a red deer's real walk. The old 12 m/s was a red deer's *open-ground
    // gallop* asked of a canter clip: rate 3.55, clamped to 3, and the owner saw the legs blur.
    walkSpeed: 1.35,
    runSpeed: 8,
    fleeRadius: 10,
    yawOffset: 0,
  },
  {
    id: "doe",
    glb: "SK_DeerDoe",
    label: "Doe",
    length: 1.8,
    clips: DOE_CLIPS,
    // Clip stride: walk 1.12 m/s, run 2.96 m/s. Lighter than the stag and a shade slower on foot.
    walkSpeed: 1.15,
    runSpeed: 7,
    fleeRadius: 11,
    yawOffset: 0,
  },
  {
    id: "pig",
    glb: "SK_Pig",
    label: "Pig",
    length: 1.5,
    clips: PIG_CLIPS,
    // Clip stride: walk 0.73 m/s, run 4.63 m/s — the pack's one genuinely fast run cycle, and a
    // boar really does hit 6-11 m/s. 7 was already a speed this clip can carry; only the walk moved.
    walkSpeed: 0.9,
    runSpeed: 7,
    fleeRadius: 6,
    yawOffset: 0,
  },
  {
    id: "crow",
    glb: "SK_Crow",
    label: "Crow",
    length: 0.5,
    clips: CROW_CLIPS,
    // Clip stride: walk 0.22 m/s, hop 0.14 m/s. Both are near enough on-the-spot, because a crow's
    // real escape is the wing and not the leg. Until `ANIM_Crow_TakeOff` drives an actual flight
    // state, a fleeing crow hops, and it hops at a speed its hop cycle can carry.
    walkSpeed: 0.3,
    runSpeed: 0.35,
    fleeRadius: 5,
    yawOffset: 0,
  },
];
