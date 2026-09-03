// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
//
// The air in the wood.
//
// A closed canopy is full of drifting things — pollen, spores, dust off the bark, the odd insect —
// and you only ever see them where a shaft of light catches them. It is the cheapest atmosphere in
// any forest game and the thing whose absence reads as "rendered" rather than "photographed": a
// valley with 46,000 plants in it and perfectly clear air between them looks like a museum diorama.
//
// The mechanism is the framework's: `GPUParticles3D` owns the pooled compute dispatch, the storage
// buffers, renderer attachment and release. Everything below is the look — where they are, how they
// move, how big, what colour, and when they are visible — which is this file's business and not the
// framework's.
import { GPUParticles3D } from "@threenative/core";
import { AdditiveBlending, Color } from "three";
import { SpriteNodeMaterial } from "three/webgpu";
import {
  Fn,
  If,
  cameraPosition,
  color,
  float,
  hash,
  instanceIndex,
  length,
  positionWorld,
  smoothstep,
  time,
  uniform,
  uv,
  vec3,
  vec4,
} from "three/tsl";
import { sunDirection } from "./light/sun.js";

/* BEGIN THREENATIVE MOTES APPEARANCE */
/**
 * How many. Four thousand sprites is nothing next to this valley's 46,190 instanced plants, and
 * the count is bounded by legibility rather than by cost: past about six thousand the air stops
 * reading as air and starts reading as snow.
 */
const MOTE_COUNT = 4_000;
/**
 * The slab they live in, in metres. Wide enough that the player never walks out of the weather,
 * low enough that they are between the eye and the trunks rather than up in the canopy where
 * nothing would ever see them.
 */
const FIELD = { height: 7.5, radius: 46, floor: 0.35 } as const;
/** Metres per second. A mote is falling at terminal velocity through still air, which is slow. */
const DRIFT = { fall: 0.055, sway: 0.16, wander: 0.42 } as const;
/** Sprite size in metres at one metre from the eye, before the distance term below. */
const MOTE_SIZE = 0.013;
/**
 * The near and far edges of the band a mote is visible in.
 *
 * Both ends matter. Nearer than `near` a mote is a fat blob across the camera and reads as dirt on
 * the lens; further than `far` the sprites converge into a uniform haze that flattens the very
 * depth the aerial perspective is drawing. Fading at both ends is what keeps them air.
 */
const VISIBLE = { near: 0.6, far: 26 } as const;
/** Warm, and dim. These are lit specks, not fireflies; a mote you can see in shade is a firefly. */
const MOTE_TINT = 0xfff2d8;
const MOTE_BRIGHTNESS = 5;
/* END THREENATIVE MOTES APPEARANCE */

/**
 * A deterministic unit random from the particle index and a salt.
 *
 * `hash` on `instanceIndex` alone would give every field the same layout, so each call that needs
 * an independent number offsets the index into a different part of the sequence.
 */
const roll = (salt: number) => hash(instanceIndex.add(float(salt).mul(float(7919)).toUint()));

/**
 * Drifting motes that catch the light, as a scene object.
 *
 * Add it with `ctx.add` so the framework attaches the renderer, sees the compute passes during
 * warm-up and releases the buffers on scene exit.
 */
export function createMotes(): GPUParticles3D {
  const material = new SpriteNodeMaterial({
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });

  // Round, and soft at the edge. A sprite's default square is the single loudest tell of a
  // particle system; the smoothstep is one instruction and removes it entirely.
  const disc = smoothstep(float(0.5), float(0.18), length(uv().sub(float(0.5))));

  // Distance from the eye, used at both ends of the visibility band and for the size.
  const distance = length(positionWorld.sub(cameraPosition));
  const near = smoothstep(float(VISIBLE.near * 0.4), float(VISIBLE.near), distance);
  const far = float(1).sub(smoothstep(float(VISIBLE.far * 0.45), float(VISIBLE.far), distance));

  // Toward the sun, a mote is a bright speck; away from it, it is nothing. This is the whole
  // reason motes read as *lit air* rather than as floating dots, and it is a dot product rather
  // than a shadow lookup because a shadow lookup per particle is not worth the frame.
  const sun = uniform(vec3(sunDirection().x, sunDirection().y, sunDirection().z));
  const toEye = positionWorld.sub(cameraPosition).normalize();
  const facing = toEye.dot(sun).mul(float(-1)).max(float(0));
  // Squared, so the falloff is quick: the band of air where motes light up should be narrow enough
  // that turning your head changes the picture.
  const lit = float(0.18).add(facing.mul(facing).mul(float(0.82)));

  material.colorNode = vec4(
    color(new Color(MOTE_TINT)).mul(float(MOTE_BRIGHTNESS)).mul(lit),
    disc.mul(near).mul(far),
  );
  // Sized in world units, so a mote does not swell as you back away from it.
  material.scaleNode = float(MOTE_SIZE).mul(distance.max(float(1)));

  return new GPUParticles3D({
    amount: MOTE_COUNT,
    material,
    process: ({ positions, velocities }) =>
      Fn(() => {
        const position = positions.element(instanceIndex);
        const velocity = velocities.element(instanceIndex);
        // Two sine terms at incommensurate rates, per-particle phase, so the field never pulses as
        // one object — the same trick the foliage wind uses, and for the same reason.
        const phase = roll(4).mul(float(Math.PI * 2));
        const sway = time.mul(float(0.31)).add(phase).sin().mul(float(DRIFT.sway));
        const wander = time.mul(float(0.17)).add(phase.mul(float(1.7))).sin();
        velocity.assign(
          vec3(
            sway.add(wander.mul(float(DRIFT.wander * 0.25))),
            float(-DRIFT.fall).add(wander.mul(float(DRIFT.fall * 0.6))),
            wander.mul(float(DRIFT.wander * 0.5)).sub(sway.mul(float(0.4))),
          ),
        );
        position.addAssign(velocity.mul(float(1 / 60)));
        // Fall out of the bottom, come back in at the top. Recycling rather than respawning keeps
        // the count constant.
        //
        // `If`, not `select`. **`select` evaluates both of its branches** — it chooses a value, it
        // does not choose whether to run something — so writing the reset as
        // `cond.select(position.y.assign(top), position.y)` assigns the top every single frame for
        // every particle. The field then falls as one solid sheet: a horizontal band of motes
        // sliding down together, which is exactly how it looked before this line was fixed, and it
        // reads as weather rather than as air.
        If(position.y.lessThan(float(FIELD.floor)), () => {
          position.y.assign(float(FIELD.floor + FIELD.height));
        });
      })().compute(MOTE_COUNT),
    // Scattered on a disc, not in a square: `sqrt` on the radius roll is what makes the density
    // even across the area rather than piled at the centre.
    start: ({ positions }) =>
      Fn(() => {
        const angle = roll(1).mul(float(Math.PI * 2));
        const radius = roll(2).sqrt().mul(float(FIELD.radius));
        positions
          .element(instanceIndex)
          .assign(
            vec3(
              angle.cos().mul(radius),
              roll(3).mul(float(FIELD.height)).add(float(FIELD.floor)),
              angle.sin().mul(radius),
            ),
          );
      })().compute(MOTE_COUNT),
  });
}
