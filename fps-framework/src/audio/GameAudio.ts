import { AudioBus } from "@threenative/core";
import {
  type Audio as AudioVoice,
  type PerspectiveCamera,
  PositionalAudio,
  Vector3,
} from "three";

/**
 * Gameplay audio, every cue through `ctx.assets.audio` and the framework's
 * `AudioBus`. No DOM audio anywhere: the bus is the only voice owner, so the
 * native build (no `window`, no `new Audio()`) plays exactly what the web does.
 */

/** Every shipped cue, keyed by role. Values are paths under `public/`. */
const CUE_FILES = {
  shotPlayer: "audio/shot-player.ogg",
  shotEnemy: "audio/shot-enemy.ogg",
  stepStone1: "audio/step-stone-1.ogg",
  stepStone2: "audio/step-stone-2.ogg",
  stepStone3: "audio/step-stone-3.ogg",
  stepStone4: "audio/step-stone-4.ogg",
  impactPlaster: "audio/impact-plaster.ogg",
  impactWood: "audio/impact-wood.ogg",
  impactSteel: "audio/impact-steel.ogg",
  impactStone: "audio/impact-stone.ogg",
  ambience: "audio/ambience-harbour.ogg",
  magOut: "audio/reload-magout.ogg",
  magIn: "audio/reload-magin.ogg",
  bodyImpact: "audio/hit-impact.ogg",
  whizz: "audio/bullet-whizz.ogg",
  // The starter scaffold ships this cue at the public root, not under audio/.
  chime: "pickup.ogg",
  barkSpot1: "audio/bark-spot-1.ogg",
  barkSpot2: "audio/bark-spot-2.ogg",
  barkSpot3: "audio/bark-spot-3.ogg",
  barkChase1: "audio/bark-chase-1.ogg",
  barkChase2: "audio/bark-chase-2.ogg",
  barkChase3: "audio/bark-chase-3.ogg",
  barkPain1: "audio/bark-pain-1.ogg",
  barkPain2: "audio/bark-pain-2.ogg",
  barkDeath1: "audio/bark-death-1.ogg",
  barkDeath2: "audio/bark-death-2.ogg",
  uiClick: "audio/ui-click.ogg",
  roundWin: "audio/round-complete.ogg",
  roundLose: "audio/round-failed.ogg",
  tick: "audio/clock-tick.ogg",
} as const;

export type CueName = keyof typeof CUE_FILES;

/** What a stray round landed on; picks the impact voice. */
export type ImpactSurface = "plaster" | "wood" | "steel" | "stone";

const STEP_VARIANTS: readonly CueName[] = [
  "stepStone1",
  "stepStone2",
  "stepStone3",
  "stepStone4",
];
/** Small deterministic playback-rate jitter so cycled steps do not machine-gun. */
const STEP_RATES: readonly number[] = [1, 0.96, 1.05, 0.98];

/** Shouted Arabic combat callouts, strictly non-religious; variants rotate per category. */
const BARK_VARIANTS: Readonly<Record<"spot" | "chase" | "pain" | "death", readonly CueName[]>> = {
  spot: ["barkSpot1", "barkSpot2", "barkSpot3"],
  chase: ["barkChase1", "barkChase2", "barkChase3"],
  pain: ["barkPain1", "barkPain2"],
  death: ["barkDeath1", "barkDeath2"],
};
/**
 * Minimum seconds between any two soldier barks across the whole squad. Five men
 * reacting at once must not collapse into a wall of shouting; one voice at a time
 * reads as a squad talking over gunfire.
 */
const BARK_GAP_SECONDS = 1.15;

type SpatialTune = {
  readonly volume: number;
  /** Panner ref distance in metres; three's default of 1 swallows distant shots. */
  readonly ref: number;
  readonly rolloff: number;
};

const TUNE = {
  shot: { volume: 0.85, ref: 7, rolloff: 0.55 } satisfies SpatialTune,
  step: { volume: 0.5, ref: 3.5, rolloff: 0.8 } satisfies SpatialTune,
  impact: { volume: 0.7, ref: 4.5, rolloff: 0.7 } satisfies SpatialTune,
  body: { volume: 0.65, ref: 5, rolloff: 0.7 } satisfies SpatialTune,
  chime: { volume: 0.55, ref: 12, rolloff: 0.35 } satisfies SpatialTune,
  /** Shouted voices sit under the gunfire, not over it. */
  bark: { volume: 0.6, ref: 4, rolloff: 0.55 } satisfies SpatialTune,
} as const;

export class GameAudio {
  /** Load every cue through the asset cache. Await from `Scene.load`. */
  static async load(
    assets: { audio(path: string): Promise<AudioBuffer> },
  ): Promise<Map<CueName, AudioBuffer>> {
    const entries = await Promise.all(
      (Object.entries(CUE_FILES) as readonly (readonly [CueName, string])[]).map(
        async ([name, path]) => [name, await assets.audio(path)] as const,
      ),
    );
    return new Map(entries);
  }

  #bus: AudioBus;
  #buffers: ReadonlyMap<CueName, AudioBuffer>;
  #stepCursor = 0;
  /** Bark variant rotation, shared across categories so repeats stay spread out. */
  #barkCursor = 0;
  /** AudioContext time of the last bark; the squad-wide throttle reads this. */
  #lastBarkAt = -Infinity;
  #barksPlayed = 0;
  /** Rifle rounds fired with sound — the playtest gate reads this. Starts at zero. */
  #playerShots = 0;
  /** Highest live voice count seen across samples; only a started WebAudio node scores above zero. */
  #peakVoices = 0;

  constructor(camera: PerspectiveCamera, buffers: ReadonlyMap<CueName, AudioBuffer>) {
    this.#bus = new AudioBus({ camera });
    this.#buffers = buffers;
  }

  /** Called once per frame so peak-voice tracking sees voices the queue starts later. */
  sample(): void {
    this.#peakVoices = Math.max(this.#peakVoices, this.#bus.voices);
  }

  /** The player's own rifle: at the ear, so plain and loud rather than panned. */
  playerShot(): void {
    if (this.#play("shotPlayer", 0.9)) this.#playerShots += 1;
  }

  /** A soldier's rifle, positioned at the muzzle. */
  enemyShot(at: Vector3): void {
    this.#spatial("shotEnemy", at, TUNE.shot);
  }

  /**
   * Incoming round passing close by: the whizz that says someone is shooting at
   * you even when the tracer went wide. Louder as the muzzle gets closer.
   */
  nearMiss(muzzleDistance: number): void {
    if (muzzleDistance >= 30) return;
    this.#play("whizz", 0.4 * (1 - muzzleDistance / 30));
  }

  /** The listener's own footfall: centred, rate-jittered, variant-cycled. */
  localStep(): void {
    const name = STEP_VARIANTS[this.#stepCursor % STEP_VARIANTS.length];
    if (name === undefined) return;
    const voice = this.#play(name, TUNE.step.volume);
    this.#stepCursor += 1;
    const rate = STEP_RATES[this.#stepCursor % STEP_RATES.length];
    if (voice !== undefined && rate !== undefined) voice.setPlaybackRate(rate);
  }

  /** A soldier's footfall, positioned at his feet — the main positional tell. */
  soldierStep(at: Vector3): void {
    const name = STEP_VARIANTS[this.#stepCursor % STEP_VARIANTS.length];
    if (name === undefined) return;
    this.#spatial(name, at, TUNE.step);
    this.#stepCursor += 1;
  }

  impact(surface: ImpactSurface, at: Vector3): void {
    const cue: CueName =
      surface === "wood"
        ? "impactWood"
        : surface === "steel"
          ? "impactSteel"
          : surface === "stone"
            ? "impactStone"
            : "impactPlaster";
    this.#spatial(cue, at, TUNE.impact);
  }

  /** A round connecting with a soldier: dull body impact at the hit point. */
  bodyImpact(at: Vector3): void {
    this.#spatial("bodyImpact", at, TUNE.body);
  }

  /** He has spotted the player. */
  soldierSpot(at: Vector3): void {
    this.#bark(BARK_VARIANTS.spot ?? [], at);
  }

  /** Gunfire pulled him off his route; he is going looking. */
  soldierChase(at: Vector3): void {
    this.#bark(BARK_VARIANTS.chase ?? [], at);
  }

  /** A round connected but he is still standing. */
  soldierPain(at: Vector3): void {
    this.#bark(BARK_VARIANTS.pain ?? [], at);
  }

  /**
   * The killing round. A death cry cut off by the squad throttle reads as a bug,
   * so it bypasses the gap and restarts the clock for everyone else.
   */
  soldierDeath(at: Vector3): void {
    this.#bark(BARK_VARIANTS.death ?? [], at, true);
  }

  /** A scoring plate knocked down: the confirmation chime. */
  plateChime(at: Vector3): void {
    this.#spatial("chime", at, TUNE.chime);
  }

  magOut(): void {
    this.#play("magOut", 0.55);
  }

  magIn(): void {
    this.#play("magIn", 0.6);
  }

  /** Pointer-lock acquisition — the click that says the mouse now steers the aim. */
  uiClick(): void {
    this.#play("uiClick", 0.6);
  }

  roundEnd(won: boolean): void {
    this.#play(won ? "roundWin" : "roundLose", 0.8);
  }

  /** Last-ten-seconds clock pulse, once per remaining second. */
  tick(): void {
    this.#play("tick", 0.5);
  }

  /** Harbour bed: gulls, water on the quay, distant town. Loops from scene enter. */
  startAmbience(): void {
    const buffer = this.#buffers.get("ambience");
    if (buffer === undefined) return;
    this.#bus.music(buffer, { fade: 2.5, loop: true, volume: 0.4 });
  }

  /** Live counters for the playtest bridge and the dev overlay. */
  debug(): {
    barksPlayed: number;
    peakVoices: number;
    playerShots: number;
    queued: number;
  } {
    return {
      barksPlayed: this.#barksPlayed,
      peakVoices: this.#peakVoices,
      playerShots: this.#playerShots,
      queued: this.#bus.queued,
    };
  }

  dispose(): void {
    this.#bus.dispose();
  }

  /**
   * One soldier voice at a time across the squad. `force` (death) bypasses the
   * gap; everything else dropped by it simply does not shout this once.
   */
  #bark(cues: readonly CueName[], at: Vector3, force = false): void {
    if (cues.length === 0) return;
    const now = this.#bus.listener.context.currentTime;
    if (!force && now - this.#lastBarkAt < BARK_GAP_SECONDS) return;
    const name = cues[this.#barkCursor % cues.length];
    if (name === undefined) return;
    this.#barkCursor += 1;
    this.#lastBarkAt = now;
    this.#barksPlayed += 1;
    this.#spatial(name, at, TUNE.bark);
  }

  #play(name: CueName, volume: number): AudioVoice | undefined {
    const buffer = this.#buffers.get(name);
    if (buffer === undefined) return undefined;
    return this.#bus.play(buffer, { volume });
  }

  #spatial(name: CueName, at: Vector3, tune: SpatialTune): void {
    const buffer = this.#buffers.get(name);
    if (buffer === undefined) return;
    const voice: PositionalAudio = this.#bus.playAt(buffer, at, { volume: tune.volume });
    // The bus exposes only fade/loop/volume, and three's panner defaults (ref 1 m,
    // rolloff 1) make a shot 20 m away all but silent. Open the curve per family.
    voice.setRefDistance(tune.ref);
    voice.setRolloffFactor(tune.rolloff);
  }
}
