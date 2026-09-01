/**
 * The animals of the wood, as data.
 *
 * Every number here is a look or a feel decision, so it lives in the game and not in any shared
 * helper: the entity machinery (`Animal.ts`) reads a spec and would run a dragon or a duck
 * unchanged. Sizes are real-world, because the GLBs arrive at wildly different scales (the fox
 * is authored nearly six units long) and normalising by the model's own bounds is what keeps a
 * fox smaller than a stag without anyone hand-tuning per-file scale factors.
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

const CANINE_CLIPS: AnimalClipMap = {
  idle: "Idle",
  idleAlt: "Idle_2",
  alert: "Idle_2_HeadLow",
  graze: "Eating",
  walk: "Walk",
  run: "Gallop",
  attack: "Attack",
  die: "Death",
  hitReact: "Idle_HitReact_Left",
  jump: "Jump_ToIdle",
};

/** The deer share a rig and a clip list, differing from the canines in two names. */
const DEER_CLIPS: AnimalClipMap = {
  ...CANINE_CLIPS,
  alert: "Idle_Headlow",
  attack: "Attack_Headbutt",
  jump: "Jump_toIdle",
};

export interface AnimalSpec {
  /** Stable id, also the GLB file stem. */
  readonly id: string;
  readonly label: string;
  /**
   * Nose-to-tail body length in metres; the loaded model is normalised to this. The brief's
   * stag is "1.5 m at the head", which a red deer stag of ~1.9 m body length stands to.
   */
  readonly length: number;
  readonly clips: AnimalClipMap;
  /** Metres per second on the walk, tuned by eye against the clips' stride. */
  readonly walkSpeed: number;
  /** Metres per second at a gallop. */
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
    label: "Fox",
    length: 1.05,
    clips: CANINE_CLIPS,
    walkSpeed: 1.3,
    runSpeed: 8,
    fleeRadius: 7,
    yawOffset: 0,
  },
  {
    id: "wolf",
    label: "Wolf",
    length: 1.55,
    clips: CANINE_CLIPS,
    walkSpeed: 1.5,
    runSpeed: 10,
    fleeRadius: 5,
    yawOffset: 0,
  },
  {
    id: "husky",
    label: "Husky",
    length: 1.4,
    clips: CANINE_CLIPS,
    walkSpeed: 1.5,
    runSpeed: 9,
    fleeRadius: 4,
    yawOffset: 0,
  },
  {
    id: "stag",
    label: "Stag",
    length: 1.9,
    clips: DEER_CLIPS,
    walkSpeed: 1.3,
    runSpeed: 12,
    fleeRadius: 10,
    yawOffset: 0,
  },
  {
    id: "doe",
    label: "Doe",
    length: 1.7,
    clips: DEER_CLIPS,
    walkSpeed: 1.2,
    runSpeed: 11,
    fleeRadius: 11,
    yawOffset: 0,
  },
];
