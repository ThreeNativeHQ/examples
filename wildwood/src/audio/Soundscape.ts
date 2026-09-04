import { AudioBus, type ICtx } from "@threenative/core";
import { Vector3 } from "three";
import type { Mesh, Object3D, PositionalAudio } from "three";
import type { IPhysicsContext } from "@threenative/physics";
import { LAKE, POND, TERRAIN_SAMPLES, TERRAIN_SIZE, WATER_LEVEL } from "../render/terrain.js";
import type { Animal, AnimalState } from "../entities/animals/Animal.js";
import type { GameState } from "../state.js";
import {
  ANIMAL_CLIPS,
  animalAudio,
  animalClipDrift,
  FEEDING_CLIPS,
  FOOT_VARIANTS,
  footClip,
  wolfHowlsWhenGrazing,
  type IAnimalAudio,
} from "./animals.js";
import {
  ALL_STEP_CLIPS,
  FOREST_BED,
  FOREST_BIRDS,
  LAKE_SHORE,
  LANDMARK_FOUND,
  LAYER_SURFACES,
  STEP_VARIANTS,
  type Surface,
  stepClip,
} from "./clips.js";
import { loadClip } from "./decode.js";

type Ctx = ICtx<GameState, IPhysicsContext>;

/** Metres of walking per footstep. Wading is a longer, heavier stride, so it is a longer gap. */
const STRIDE = 0.82;
const WADE_STRIDE = 1.15;
/**
 * Feet-above-ground past which a step is a jump, not a step.
 *
 * `groundGap` is the walker's own measure of sole minus terrain, and it sits near zero on flat
 * ground and a few centimetres on a slope. Anything past this is air.
 */
const AIRBORNE_GAP = 0.4;
/**
 * A respawn or a teleport moves the odometer by more than any frame can. Treat a jump larger than
 * this as "somewhere else" and resynchronise rather than firing a burst of steps to catch up.
 */
const TELEPORT_METRES = 6;

/** How far the wood drops under a discovery cue, and how long it takes to come back. */
const DUCK_VOLUME = 0.32;
const DUCK_IN = 0.18;
const DUCK_HOLD = 1.5;
const DUCK_OUT = 1.4;

/** Levels. The two beds sum to roughly one bed; the wind is the layer, the birds are the detail. */
const BED_VOLUME = 0.5;
const BIRDS_VOLUME = 0.3;
const WATER_VOLUME = 0.85;
const STEP_VOLUME = 0.3;
const CUE_VOLUME = 0.9;

/**
 * Positional falloff for the water. `refDistance` is where attenuation starts and `rolloffFactor`
 * is how fast it falls after; three's defaults of 1 m and 1 make a lake inaudible from ten paces.
 * At 6 m the shore is at full level, at 30 m it is a tenth of it, which is "you can hear water
 * that way" without being a wall of it from across the valley.
 */
const WATER_REF_DISTANCE = 6;
const WATER_ROLLOFF = 2;

/**
 * A call carries; a footfall does not. Two rolloffs, because using one made either the stag
 * inaudible across a clearing or its hooves audible from the ridge.
 */
const VOICE_ROLLOFF = 1.5;
const BODY_ROLLOFF = 2.6;

/** Levels for the animals, all well under the walker's own feet. */
const ALARM_VOLUME = 0.85;
const CALL_VOLUME = 0.5;
const FEEDING_VOLUME = 0.55;
const FOOT_VOLUME = 0.45;

/** Seconds between a settled animal's idle calls, per animal, randomised in this range. */
const CALL_GAP_MIN = 22;
const CALL_GAP_MAX = 70;
/** Seconds between bites while grazing. A bite is a discrete event, not a held loop. */
const BITE_GAP_MIN = 1.8;
const BITE_GAP_MAX = 3.4;
/**
 * Footfalls emitted in one frame, at most.
 *
 * A frame that covers many strides is a teleport or a hitch, not a gallop, and replaying the
 * backlog turns it into a drum roll.
 */
const MAX_FOOTFALLS_PER_FRAME = 2;

/** Per-animal bookkeeping. Keyed by identity, so the detail tier's swap is not a burst of cues. */
interface IAnimalTrack {
  state: AnimalState;
  x: number;
  z: number;
  /** Metres covered since the last footfall. */
  travelled: number;
  callAt: number;
  biteAt: number;
  foot: number;
}

interface IWaterBody {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

const WATER_BODIES: readonly IWaterBody[] = [
  { x: LAKE.x, z: LAKE.z, radius: LAKE.radius },
  { x: POND.x, z: POND.z, radius: POND.radius },
];

export interface ISoundscapeOptions {
  readonly camera: Object3D;
  /** The drawn terrain. Its `layerWeight` attribute is what decides the surface underfoot. */
  readonly terrain: Mesh;
}

export interface IWalkerSound {
  readonly position: Vector3;
  readonly odometer: number;
  readonly groundGap: number;
  readonly wading: boolean;
  /** Seconds this frame. Drives the call and bite timers, so they stop when the game pauses. */
  readonly dt: number;
  /**
   * The animals as they are right now. `undefined` before the wood is inhabited, and a different
   * array once the detail tier lands — which is why tracking is keyed by animal identity.
   */
  readonly animals?: readonly Animal[] | undefined;
}

/**
 * Everything the wood sounds like, on two buses.
 *
 * Two rather than one because ducking needs somewhere to duck: `ambience` carries the beds, the
 * water and the footsteps and drops under `cues`, which carries the single sound in this game a
 * player is waiting for. One `AudioBus` per category is the engine's mixing concept, and
 * `setVolume` on the bus is the whole of it.
 *
 * Loading is asynchronous and deliberately not awaited by the scene: the wood should appear when
 * it is drawn, not when its ambience has downloaded. Every path here is a no-op until its buffer
 * lands, and the beds fade in whenever that is.
 */
export class Soundscape {
  readonly #ambience: AudioBus;
  readonly #cues: AudioBus;
  readonly #terrain: Mesh;
  #chime: AudioBuffer | undefined;
  #steps = new Map<string, AudioBuffer>();
  #water: PositionalAudio[] = [];
  #lastVariant = new Map<Surface, number>();
  #lastStepAt: number | undefined;
  #surface: Surface = "grass";
  /** One scratch vector for every shore query; this runs each frame per body of water. */
  readonly #scratch = new Vector3();
  #stepsPlayed = 0;
  #paused = false;
  #disposed = false;
  #beds = 0;
  #animalClips = new Map<string, AudioBuffer>();
  #tracks = new WeakMap<Animal, IAnimalTrack>();
  #animalCues = 0;
  #clock = 0;
  /** Species whose graze clip no longer matches what the audio table was written against. */
  readonly #clipDrift: readonly string[] = animalClipDrift();

  constructor(options: ISoundscapeOptions) {
    this.#ambience = new AudioBus({ camera: options.camera });
    this.#cues = new AudioBus({ camera: options.camera });
    this.#terrain = options.terrain;
    void this.#load();
  }

  /** What a playtest sees in the entity snapshot. */
  debug(): Record<string, unknown> {
    return {
      beds: this.#beds,
      paused: this.#paused,
      steps: this.#stepsPlayed,
      surface: this.#surface,
      // Named rather than assumed: on a native target the bus drops `detune`, so every footstep
      // is bit-identical and the walk sounds mechanical. Better in the snapshot than a surprise.
      unsupported: [...this.#ambience.unsupported],
      water: this.#water.length,
      animalCues: this.#animalCues,
      animalClips: this.#animalClips.size,
      // Empty is the healthy answer. Non-empty means an animation changed and its sound did not.
      clipDrift: [...this.#clipDrift],
    };
  }

  update(ctx: Ctx, walker: IWalkerSound): void {
    if (this.#disposed) return;
    this.#syncPause(ctx.state.getState().paused);
    if (this.#paused) return;
    this.#clock += walker.dt;
    this.#followWater(walker.position);
    this.#walk(walker);
    if (walker.animals !== undefined) this.#inhabit(walker.animals);
  }

  /** The one event this game acknowledges. Cue on its own bus, wood ducked under it. */
  discovered(ctx: Ctx): void {
    if (this.#disposed || this.#chime === undefined) return;
    this.#cues.play(this.#chime, { volume: CUE_VOLUME });
    this.#ambience.setVolume(DUCK_VOLUME, DUCK_IN);
    ctx.after(DUCK_HOLD, () => {
      if (!this.#disposed) this.#ambience.setVolume(1, DUCK_OUT);
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#water = [];
    this.#steps.clear();
    // Both buses, or the listener stays on the camera and every voice stays in the scene graph.
    this.#ambience.dispose();
    this.#cues.dispose();
  }

  async #load(): Promise<void> {
    const context = this.#ambience.listener.context;
    const settled = await Promise.allSettled([
      loadClip(context, FOREST_BED.path),
      loadClip(context, FOREST_BIRDS.path),
      loadClip(context, LAKE_SHORE.path),
      // Same context: three hands every `AudioListener` the one shared `AudioContext`, so a
      // buffer decoded for one bus plays on the other.
      loadClip(context, LANDMARK_FOUND.path),
      ...ALL_STEP_CLIPS.map((path) => loadClip(context, path)),
      ...ANIMAL_CLIPS.map((path) => loadClip(context, path)),
    ]);
    if (this.#disposed) return;
    const buffer = (index: number): AudioBuffer | undefined => {
      const result = settled[index];
      return result?.status === "fulfilled" ? result.value : undefined;
    };

    const bed = buffer(0);
    // Long fades: an ambient bed that arrives at full level announces that it arrived.
    if (bed !== undefined) {
      this.#ambience.music(bed, { volume: BED_VOLUME, fade: 3 });
      this.#beds += 1;
    }
    const birds = buffer(1);
    if (birds !== undefined) {
      this.#ambience.music(birds, { volume: BIRDS_VOLUME, fade: 4 });
      this.#beds += 1;
    }
    const water = buffer(2);
    if (water !== undefined) this.#startWater(water);
    this.#chime = buffer(3);
    ALL_STEP_CLIPS.forEach((path, index) => {
      const step = buffer(4 + index);
      if (step !== undefined) this.#steps.set(path, step);
    });
    const animalStart = 4 + ALL_STEP_CLIPS.length;
    ANIMAL_CLIPS.forEach((path, index) => {
      const clip = buffer(animalStart + index);
      if (clip !== undefined) this.#animalClips.set(path, clip);
    });
    if (this.#clipDrift.length > 0) {
      // Loud, and in `debug()` as well: a chew over an animal that is visibly looking around is a
      // defect no size, duration or load marker can see.
      for (const line of this.#clipDrift) console.warn(`TN_AUDIO_ANIMAL_CLIP_DRIFT ${line}`);
    }
    const missing = settled.filter(({ status }) => status === "rejected").length;
    if (missing > 0) console.warn(`TN_AUDIO_MISSING:${String(missing)}`);
    console.info(
      `TN_AUDIO_READY beds=${String(this.#beds)} steps=${String(this.#steps.size)} ` +
        `water=${String(this.#water.length)} animals=${String(this.#animalClips.size)} ` +
        `clipDrift=${String(this.#clipDrift.length)}`,
    );
  }

  /**
   * One looping voice per body of water, riding the nearest point of its shore.
   *
   * A lake 68 m across is not a point source: parked at the centre it is loudest from the middle
   * of the water, where nobody stands. Putting the emitter on the shoreline nearest the listener
   * makes the distance the panner sees the distance to the water's edge, which is the distance a
   * person means by "near the lake".
   */
  #startWater(buffer: AudioBuffer): void {
    for (const body of WATER_BODIES) {
      const voice = this.#ambience.playAt(buffer, this.#shore(body, body.x + body.radius, body.z), {
        loop: true,
        volume: WATER_VOLUME,
        fade: 2,
        refDistance: WATER_REF_DISTANCE,
        rolloffFactor: WATER_ROLLOFF,
      });
      this.#water.push(voice);
    }
  }

  #shore(body: IWaterBody, x: number, z: number): Vector3 {
    const dx = x - body.x;
    const dz = z - body.z;
    const distance = Math.hypot(dx, dz);
    // Dead centre of the lake has no nearest shore; any point on the circle is as good.
    const scale = distance < 1e-3 ? 0 : body.radius / distance;
    return this.#scratch.set(body.x + dx * scale, WATER_LEVEL, body.z + dz * scale);
  }

  #followWater(position: Vector3): void {
    this.#water.forEach((voice, index) => {
      const body = WATER_BODIES[index];
      // The bus reclaims a voice once it stops, so a reference held past that point addresses
      // somebody else's sound. For a loop that only ends at dispose this never trips, and the
      // check is what makes that guarantee explicit rather than assumed.
      if (body === undefined || !voice.isPlaying) return;
      voice.position.copy(this.#shore(body, position.x, position.z));
    });
  }

  #walk(walker: IWalkerSound): void {
    const previous = this.#lastStepAt;
    if (previous === undefined || Math.abs(walker.odometer - previous) > TELEPORT_METRES) {
      this.#lastStepAt = walker.odometer;
      return;
    }
    this.#surface = walker.wading ? "water" : this.#surfaceAt(walker.position);
    if (walker.groundGap > AIRBORNE_GAP) return;
    const stride = walker.wading ? WADE_STRIDE : STRIDE;
    if (walker.odometer - previous < stride) return;
    this.#lastStepAt = walker.odometer;
    this.#step(this.#surface);
  }

  #step(surface: Surface): void {
    const last = this.#lastVariant.get(surface);
    let variant = Math.min(Math.floor(Math.random() * STEP_VARIANTS), STEP_VARIANTS - 1);
    // Never the same take twice running: two identical footsteps in a row is the single loudest
    // tell that a game is playing samples rather than walking.
    if (variant === last) variant = (variant + 1) % STEP_VARIANTS;
    this.#lastVariant.set(surface, variant);
    const buffer = this.#steps.get(stepClip(surface, variant));
    if (buffer === undefined) return;
    this.#ambience.play(buffer, {
      volume: STEP_VOLUME * (0.85 + Math.random() * 0.3),
      // Cents. Web only — the native host binds an inert `detune`, and the bus says so in
      // `unsupported`, which is why the three takes above carry the variation that has to work
      // everywhere and this only sharpens it.
      detune: (Math.random() - 0.5) * 70,
    });
    this.#stepsPlayed += 1;
  }

  /**
   * Give the wood its inhabitants.
   *
   * Everything here hangs off `animal.state` and `animal.spec.id`, and every voice is welded to
   * the animal's own `Object3D` so it moves with the body rather than playing from where the
   * animal was when the cue fired.
   */
  #inhabit(animals: readonly Animal[]): void {
    for (const animal of animals) {
      const audio = animalAudio(animal.spec.id);
      if (audio === undefined) continue;
      const position = animal.object.position;
      let track = this.#tracks.get(animal);
      if (track === undefined) {
        // First sight: adopt the current state silently. The detail tier replaces every animal,
        // and treating that as six simultaneous state changes would fire six alarms at once.
        track = {
          state: animal.state,
          x: position.x,
          z: position.z,
          travelled: 0,
          callAt: this.#clock + this.#between(CALL_GAP_MIN, CALL_GAP_MAX),
          biteAt: this.#clock + this.#between(BITE_GAP_MIN, BITE_GAP_MAX),
          foot: 0,
        };
        this.#tracks.set(animal, track);
        continue;
      }

      track.travelled += Math.hypot(position.x - track.x, position.z - track.z);
      track.x = position.x;
      track.z = position.z;

      if (animal.state !== track.state) {
        this.#entered(animal, audio, animal.state, track);
        track.state = animal.state;
      }
      this.#footfalls(animal, audio, track);
      this.#feed(animal, audio, track);
      this.#call(animal, audio, track);
    }
  }

  /** A state the animal has just entered. Only two of the four make a sound of their own. */
  #entered(animal: Animal, audio: IAnimalAudio, state: AnimalState, track: IAnimalTrack): void {
    if (state === "flee") {
      // The alarm, at the moment of bolting. This is the one animal cue a player is meant to
      // notice, because it is the wood reacting to them.
      this.#voice(animal, audio, ALARM_VOLUME);
      if (audio.foot === "wing") this.#emit(animal, audio, footClip("wing", 0), FOOT_VOLUME, 0.9);
      return;
    }
    if (state === "graze") {
      // The wolf's graze clip is a howl, so its graze sound is the howl and there are no bites.
      if (wolfHowlsWhenGrazing(animal.spec.id)) this.#voice(animal, audio, CALL_VOLUME);
      else track.biteAt = this.#clock + this.#between(0.3, 1.2);
    }
  }

  /**
   * Footfalls, paid for by the metre.
   *
   * Emitting per metre covered rather than per second is what keeps them locked to the gait: the
   * same animal walking and bolting is playing two different clips at two different speeds, and
   * neither this code nor the clip's authored rate has to be consulted for the cadence to follow.
   */
  #footfalls(animal: Animal, audio: IAnimalAudio, track: IAnimalTrack): void {
    let emitted = 0;
    while (track.travelled >= audio.stride && emitted < MAX_FOOTFALLS_PER_FRAME) {
      track.travelled -= audio.stride;
      emitted += 1;
      track.foot = (track.foot + 1) % FOOT_VARIANTS;
      this.#emit(animal, audio, footClip(audio.foot, track.foot), FOOT_VOLUME, BODY_ROLLOFF);
    }
    // Whatever is left over after the cap is dropped rather than banked, so a hitch does not
    // repay itself as a drum roll on the next frame.
    if (emitted >= MAX_FOOTFALLS_PER_FRAME) track.travelled = 0;
  }

  /** A bite, while grazing, for the species whose graze clip is actually eating. */
  #feed(animal: Animal, audio: IAnimalAudio, track: IAnimalTrack): void {
    if (animal.state !== "graze" || audio.feeding === "none") return;
    if (this.#clock < track.biteAt) return;
    track.biteAt = this.#clock + this.#between(BITE_GAP_MIN, BITE_GAP_MAX);
    this.#emit(animal, audio, FEEDING_CLIPS[audio.feeding], FEEDING_VOLUME, BODY_ROLLOFF);
  }

  /** The occasional call from a settled animal, so a still wood is not a silent one. */
  #call(animal: Animal, audio: IAnimalAudio, track: IAnimalTrack): void {
    if (animal.state === "flee" || this.#clock < track.callAt) return;
    track.callAt = this.#clock + this.#between(CALL_GAP_MIN, CALL_GAP_MAX);
    this.#voice(animal, audio, CALL_VOLUME);
  }

  #voice(animal: Animal, audio: IAnimalAudio, volume: number): void {
    this.#emit(animal, audio, audio.voice, volume, VOICE_ROLLOFF);
  }

  /** One positional cue, welded to the animal so it travels with the body. */
  #emit(
    animal: Animal,
    audio: IAnimalAudio,
    path: string,
    volume: number,
    rolloff: number,
  ): void {
    const buffer = this.#animalClips.get(path);
    if (buffer === undefined) return;
    this.#ambience.playAt(buffer, animal.object, {
      volume: volume * (0.85 + Math.random() * 0.3),
      refDistance: audio.refDistance,
      rolloffFactor: rolloff,
      // Cents. Web only — the bus reports `detune` as unsupported on native, which is why the
      // footfalls carry two takes rather than relying on this for their variation.
      detune: (Math.random() - 0.5) * 90,
    });
    this.#animalCues += 1;
  }

  #between(low: number, high: number): number {
    return low + Math.random() * (high - low);
  }

  /**
   * The surface underfoot, read off the drawn mesh.
   *
   * `terrain.ts` writes a four-way `layerWeight` per vertex — grass, needle litter, rock, dirt —
   * and the shader mixes the ground textures by it. Reading the same attribute means the footstep
   * and the texture under it can never disagree, which recomputing `layerWeights` over here would
   * guarantee they eventually do.
   */
  #surfaceAt(position: Vector3): Surface {
    const attribute = this.#terrain.geometry.getAttribute("layerWeight");
    if (attribute === undefined) return "grass";
    const step = TERRAIN_SIZE / (TERRAIN_SAMPLES - 1);
    const half = TERRAIN_SIZE / 2;
    const ix = Math.round((position.x + half) / step);
    const iz = Math.round((position.z + half) / step);
    if (ix < 0 || iz < 0 || ix >= TERRAIN_SAMPLES || iz >= TERRAIN_SAMPLES) return "grass";
    const vertex = ix * TERRAIN_SAMPLES + iz;
    let best = 0;
    let bestWeight = -1;
    for (let layer = 0; layer < LAYER_SURFACES.length; layer += 1) {
      const weight = attribute.getComponent(vertex, layer);
      if (weight > bestWeight) {
        bestWeight = weight;
        best = layer;
      }
    }
    return LAYER_SURFACES[best] ?? "grass";
  }

  #syncPause(paused: boolean): void {
    if (paused === this.#paused) return;
    this.#paused = paused;
    // A pause, not a stop: the bed resumes mid-gust rather than restarting, and the queued cues a
    // player generated on the way into the menu do not all fire when they leave it.
    if (paused) {
      this.#ambience.pause();
      this.#cues.pause();
    } else {
      this.#ambience.resume();
      this.#cues.resume();
    }
  }
}
