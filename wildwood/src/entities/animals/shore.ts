/**
 * Water is a wall to a walking animal.
 *
 * The deer walked across the lake because nothing in the wood ever told them it was there:
 * `Animal` picked a wander target inside a square around home, turned toward it, and stepped —
 * three decisions, none of which asks what the ground is. The valley's water is not an object
 * the animal can collide with either. It is a *region*: the set of points where the terrain's own
 * `heightAt` drops below the waterline, which is the same predicate `createWater` uses to decide
 * which grid cells get triangles, so avoiding it avoids exactly the surface the player can see.
 *
 * Three layers, because one is not enough and each catches what the one above it misses:
 *
 * 1. **Never aim at it.** A wander target on the far bank is rejected, *and so is a target whose
 *    straight line crosses the water* — otherwise the animal spends every frame of the walk
 *    fighting the steering below, pressed against the shore like a fly on glass.
 * 2. **Steer around it.** Whisker probes fan out from the heading; the animal takes the smallest
 *    turn whose path stays dry. This is what makes it walk *around* an inlet rather than stop at
 *    it, and it is the only layer a bolting animal has, because a flee heading is chosen by the
 *    threat and not by any target.
 * 3. **Refuse the step.** Before the body moves, the destination is tested. This never fires when
 *    the two above are working and it is the reason a frame that beats them still cannot put a
 *    hoof in the lake.
 *
 * Everything here is a plain function of `(x, z)`. It carries no terrain, no scene and no Three.js:
 * the predicate arrives from the caller, so the same code runs against the valley's heightfield,
 * against a harness's flat plane, and against a unit test's hand-drawn puddle.
 */

/** True where a point stands in water. `(x, z)` are world metres. */
export type WaterTest = (x: number, z: number) => boolean;

export interface IShoreOptions {
  /**
   * How much dry ground the animal keeps between its feet and the waterline, in metres.
   *
   * Not decoration: the body is metres long and the position is one point under it, so an animal
   * standing exactly on the waterline has half of itself in the water. Roughly half the body
   * length is what reads as "it stopped at the edge".
   */
  readonly margin: number;
  /** How far ahead the whiskers reach, in metres. Scale it with speed or a fast animal turns late. */
  readonly lookahead: number;
  /**
   * Which way this animal prefers to round an obstacle, +1 or -1.
   *
   * Without a fixed preference an animal at the apex of a bay finds the left and right whiskers
   * equally good on alternating frames and shivers on the spot. One stable side per animal turns
   * that into a walk along the shore.
   */
  readonly handedness: 1 | -1;
}

/** Turns the whiskers try, in radians, smallest first. The last one is "go back the way you came". */
const WHISKERS = [0, 0.35, 0.7, 1.15, 1.7, 2.4, Math.PI] as const;

/** Samples taken along a probed path, not counting its start. Three is enough at these speeds. */
const PATH_STEPS = 3;

/** Bearings tried per ring when hunting for dry land. */
const RESCUE_BEARINGS = 16;

/** How far out the rescue search gives up, in metres. Past this the placement is simply wrong. */
const RESCUE_RADIUS = 48;

/**
 * The shoreline, as the one question a walking animal needs to ask about it.
 */
export class Shore {
  readonly margin: number;
  readonly lookahead: number;
  /** Which way this animal rounds an obstacle. Read by the caller's own turn-in-place fallback. */
  readonly handedness: 1 | -1;

  readonly #isWater: WaterTest;

  constructor(isWater: WaterTest, options: IShoreOptions) {
    this.#isWater = isWater;
    this.handedness = options.handedness;
    this.margin = options.margin;
    this.lookahead = options.lookahead;
  }

  /**
   * Whether a point is off limits: in the water, or within `margin` of it.
   *
   * Five samples rather than one. A single centre test lets an animal stand with its shoulder
   * submerged and call itself dry, and it also lets a step of 20 cm hop clean over a shoreline
   * the test never saw.
   */
  blocked(x: number, z: number): boolean {
    const m = this.margin;
    return (
      this.#isWater(x, z) ||
      this.#isWater(x + m, z) ||
      this.#isWater(x - m, z) ||
      this.#isWater(x, z + m) ||
      this.#isWater(x, z - m)
    );
  }

  /** Whether a straight walk of `distance` metres along `heading` stays dry the whole way. */
  clearAhead(x: number, z: number, heading: number, distance: number): boolean {
    const dx = Math.sin(heading);
    const dz = Math.cos(heading);
    for (let step = 1; step <= PATH_STEPS; step += 1) {
      const t = (distance * step) / PATH_STEPS;
      if (this.blocked(x + dx * t, z + dz * t)) return false;
    }
    return true;
  }

  /** Whether the straight line from one point to another stays dry, sampled about every metre. */
  clearBetween(fromX: number, fromZ: number, toX: number, toZ: number): boolean {
    const dx = toX - fromX;
    const dz = toZ - fromZ;
    const distance = Math.hypot(dx, dz);
    if (distance < 1e-6) return !this.blocked(fromX, fromZ);
    const steps = Math.max(2, Math.ceil(distance));
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      if (this.blocked(fromX + dx * t, fromZ + dz * t)) return false;
    }
    return true;
  }

  /**
   * The heading closest to `heading` whose path stays dry, or a turn away when every whisker is wet.
   *
   * `distance` is how far ahead to care about; pass the animal's speed times a second or two so a
   * bolting stag commits to its turn while the water is still four metres off rather than one.
   */
  steer(x: number, z: number, heading: number, distance: number): number {
    for (const turn of WHISKERS) {
      if (turn === 0) {
        if (this.clearAhead(x, z, heading, distance)) return heading;
        continue;
      }
      // Preferred side first, so an animal rounding a bay keeps rounding it the same way instead
      // of finding both sides equally good and shaking between them.
      const first = heading + turn * this.handedness;
      if (this.clearAhead(x, z, first, distance)) return first;
      const second = heading - turn * this.handedness;
      if (this.clearAhead(x, z, second, distance)) return second;
    }
    // Boxed in — a spit of land with water on three sides, or a spawn already in the shallows.
    // Turning back the way it came is always the way out of a place it walked into.
    return heading + Math.PI;
  }

  /**
   * The nearest dry standing spot to a point, or the point itself when the search finds none.
   *
   * Used once per animal, at spawn: a placement typed into a scene file has no idea where the
   * terrain noise put the waterline, and an animal that starts in the lake has nothing to steer
   * away from — every whisker is wet and layer 3 pins it in place forever.
   */
  nearestDry(x: number, z: number): { readonly x: number; readonly z: number } {
    if (!this.blocked(x, z)) return { x, z };
    for (let radius = this.margin; radius <= RESCUE_RADIUS; radius += this.margin) {
      for (let bearing = 0; bearing < RESCUE_BEARINGS; bearing += 1) {
        const angle = (bearing / RESCUE_BEARINGS) * Math.PI * 2;
        const candidate = { x: x + Math.cos(angle) * radius, z: z + Math.sin(angle) * radius };
        if (!this.blocked(candidate.x, candidate.z)) return candidate;
      }
    }
    return { x, z };
  }
}

/**
 * The water predicate a caller gets for free from the ground function it already has.
 *
 * Every consumer of this game's terrain passes `heightAt`, and standing water in this valley is
 * defined as ground below the waterline — `water.covers()` is this same line. Deriving it here is
 * what lets the scene keep its two-line integration: the animals avoid the water without the
 * scene being told twice where the water is, and a scene that moves its waterline moves theirs.
 */
export function waterFromGround(
  ground: (x: number, z: number) => number,
  level: number,
): WaterTest {
  return (x, z) => ground(x, z) < level;
}
