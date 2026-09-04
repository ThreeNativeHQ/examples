import { ANIMAL_SPECS } from "../entities/animals/animalSpecs.js";

/**
 * What each animal sounds like, keyed to what its clips actually do.
 *
 * The important idea here is that **the state name is not enough**. `Animal`'s states are `idle`,
 * `graze`, `wander` and `flee` for every species, but what a species *does* in a state is decided
 * by its clip map in `animalSpecs.ts`, and two of those maps do something the state name does not
 * suggest:
 *
 * - The wolf's `graze` clip is `ANIM_Wolf_Howl`. A wolf in the `graze` state is howling, not
 *   eating, so it gets the howl and no chewing at all.
 * - The fox's `graze` clip is `ANIM_Fox_IdleLookAround`. The fox has no eating animation in the
 *   pack, so a chewing sound would play over an animal visibly looking around. It gets silence.
 *
 * Both are recorded as `grazeClip` below and **checked against the spec at load** by
 * `animalClipDrift`. If another lane renames or repoints a clip, the audio stops matching the
 * animation, and that has to be loud rather than silent — it is exactly the class of defect that
 * every other check passes.
 */

/** Which feeding sound a species gets, or none when its `graze` clip is not eating. */
export type FeedingSound = "crow" | "none" | "pig" | "ungulate";
/** Which foot hits the ground. Grouped by foot, not by species: a hoof is a hoof. */
export type FootSound = "hoof" | "paw" | "trotter" | "wing";

export interface IAnimalAudio {
  /** The species' one call. Fires on alarm, and occasionally while settled. */
  readonly voice: string;
  readonly feeding: FeedingSound;
  readonly foot: FootSound;
  /**
   * Metres of travel per footfall, about 0.45 of body length for a quadruped.
   *
   * Footfalls are emitted per metre covered rather than per second, so cadence follows the
   * animal's actual speed and a bolt sounds like a bolt without anything reading the clip's rate.
   */
  readonly stride: number;
  /** Metres before positional attenuation starts. A stag carries further than a fox. */
  readonly refDistance: number;
  /** The clip this species' `graze` state plays, as `animalSpecs.ts` declares it today. */
  readonly grazeClip: string;
}

const AUDIO: Readonly<Record<string, IAnimalAudio>> = {
  fox: {
    voice: "audio/voice-fox.ogg",
    // `ANIM_Fox_IdleLookAround` — the fox is looking around, not eating.
    feeding: "none",
    foot: "paw",
    stride: 0.47,
    refDistance: 4.2,
    grazeClip: "ANIM_Fox_IdleLookAround",
  },
  wolf: {
    voice: "audio/voice-wolf.ogg",
    // `ANIM_Wolf_Howl` — the howl *is* this species' graze sound; see `wolfHowlsWhenGrazing`.
    feeding: "none",
    foot: "paw",
    stride: 0.7,
    refDistance: 6.2,
    grazeClip: "ANIM_Wolf_Howl",
  },
  stag: {
    voice: "audio/voice-stag.ogg",
    feeding: "ungulate",
    foot: "hoof",
    stride: 0.95,
    refDistance: 8.4,
    grazeClip: "ANIM_DeerStag_IdleGraze",
  },
  doe: {
    voice: "audio/voice-doe.ogg",
    feeding: "ungulate",
    foot: "hoof",
    stride: 0.81,
    refDistance: 7.2,
    grazeClip: "ANIM_DeerDoe_IdleGraze",
  },
  pig: {
    voice: "audio/voice-pig.ogg",
    feeding: "pig",
    foot: "trotter",
    stride: 0.68,
    refDistance: 6,
    grazeClip: "ANIM_Pig_Chew",
  },
  crow: {
    voice: "audio/voice-crow.ogg",
    feeding: "crow",
    // A crow on the ground hops and flaps; it has no footfall worth hearing.
    foot: "wing",
    stride: 0.35,
    refDistance: 4,
    grazeClip: "ANIM_Crow_EatSomething",
  },
};

export function animalAudio(id: string): IAnimalAudio | undefined {
  return AUDIO[id];
}

/** True when this species' `graze` state plays a howl rather than eating. */
export function wolfHowlsWhenGrazing(id: string): boolean {
  return id === "wolf";
}

export const FEEDING_CLIPS: Readonly<Record<Exclude<FeedingSound, "none">, string>> = {
  ungulate: "audio/graze-ungulate.ogg",
  pig: "audio/graze-pig.ogg",
  crow: "audio/graze-crow.ogg",
};

/** Two takes of each foot, so a walking animal does not machine-gun one sample. */
export const FOOT_VARIANTS = 2;

export function footClip(foot: FootSound, variant: number): string {
  if (foot === "wing") return "audio/wing-crow.ogg";
  return `audio/step-${foot}-${String(variant + 1)}.ogg`;
}

/** Every clip this module needs, for the loader. */
export const ANIMAL_CLIPS: readonly string[] = [
  ...Object.values(AUDIO).map(({ voice }) => voice),
  ...Object.values(FEEDING_CLIPS),
  "audio/wing-crow.ogg",
  ...(["hoof", "paw", "trotter"] as const).flatMap((foot) =>
    Array.from({ length: FOOT_VARIANTS }, (_, variant) => footClip(foot, variant)),
  ),
];

/**
 * Species whose `graze` clip is no longer the one this table was written against.
 *
 * Empty is the healthy answer. A non-empty list means the animation changed and the sound did
 * not, so the caller silences that species' feeding rather than playing a chew over an animal
 * that is no longer eating — and reports it, because a sound that contradicts the picture is a
 * defect nothing else in the build can see.
 */
export function animalClipDrift(): readonly string[] {
  const drift: string[] = [];
  for (const spec of ANIMAL_SPECS) {
    const audio = AUDIO[spec.id];
    if (audio === undefined) {
      drift.push(`${spec.id}: no audio declared`);
      continue;
    }
    if (spec.clips.graze !== audio.grazeClip) {
      drift.push(`${spec.id}: graze clip is ${spec.clips.graze}, audio expects ${audio.grazeClip}`);
    }
  }
  return drift;
}
