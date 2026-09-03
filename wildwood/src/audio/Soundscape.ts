import { AudioBus, type ICtx } from "@threenative/core";
import { Vector3 } from "three";
import type { Mesh, Object3D, PositionalAudio } from "three";
import type { IPhysicsContext } from "@threenative/physics";
import { LAKE, POND, TERRAIN_SAMPLES, TERRAIN_SIZE, WATER_LEVEL } from "../render/terrain.js";
import type { GameState } from "../state.js";
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
    };
  }

  update(ctx: Ctx, walker: IWalkerSound): void {
    if (this.#disposed) return;
    this.#syncPause(ctx.state.getState().paused);
    if (this.#paused) return;
    this.#followWater(walker.position);
    this.#walk(walker);
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
    const missing = settled.filter(({ status }) => status === "rejected").length;
    if (missing > 0) console.warn(`TN_AUDIO_MISSING:${String(missing)}`);
    console.info(
      `TN_AUDIO_READY beds=${String(this.#beds)} steps=${String(this.#steps.size)} water=${String(this.#water.length)}`,
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
