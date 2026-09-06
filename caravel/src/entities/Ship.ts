import type { ICtx } from "@threenative/core";
import type { SpectralOcean } from "@threenative/core";
import {
  Buoyancy3D,
  CollisionShape3D,
  type IPhysicsContext,
  RigidBody3D,
} from "@threenative/physics";
import { type Object3D, Group, MathUtils } from "three";
import { prepareShipConventions } from "../conventions.js";
import { createMaterials } from "../render/materials.js";
import { surfaceHeight } from "../render/ocean.js";
import { createShipModel } from "../render/props.js";
import type { ITouchInput } from "../render/touch-controls.js";
import type { GameState } from "../state.js";

type GameCtx = ICtx<GameState, IPhysicsContext>;

/**
 * `SpectralOcean` as the water surface `Buoyancy3D` measures against.
 *
 * The two contracts differ by exactly this adapter: buoyancy asks for a height at a point and a
 * time, and the ocean answers with a height and the age in frames of the GPU copy it came from.
 * Before the first readback lands there is no answer at all, and mean sea level is the right one
 * to give — `Buoyancy3D` rejects a non-finite height by name, so returning nothing is not an
 * option and returning `NaN` would take the whole scene down on frame one.
 */
function oceanSurface(
  ocean: SpectralOcean,
  step: () => number,
): { sample(x: number, z: number): { height: number } } {
  return {
    // The same age-corrected read the drawn hull uses, so the solver pushes against the water the
    // player can see rather than against the water of several frames ago. `step` is a closure
    // because `Buoyancy3D` calls this from inside the physics step and has no delta to hand over.
    sample: (x, z) => ({ height: surfaceHeight(ocean, x, z, step()) ?? 0 }),
  };
}

/** Hull speed at full wind, in metres per second — about nine knots at the 4.6 m convention. */
const MAX_SPEED = 4.6;
/** Rate of turn with full way on and the rudder hard over, in radians per second. */
const TURN_RATE = 0.78;
/** How quickly the hull picks up and loses way, as an exponential rate. Ships are heavy. */
const WAY_RATE = 0.9;
/** The hull's draught at the template's 4.6 m convention, in world metres. */
const DESIGN_DRAUGHT = 0.62;
/** How far the model rides above its own origin, so the sea meets it lower down the topsides. */
const FREEBOARD_TRIM = 0.16;

/** Half the hull's length and half its beam: where the swell is probed for pitch and roll. */
const HALF_LENGTH = 1.7;
const HALF_BEAM = 0.95;

export class Ship {
  /** The physics body's transform. Heave comes from here; attitude does not. */
  readonly mesh = new Group();
  /** What the player sees: the body's position, with an attitude taken from the swell. */
  readonly visual = new Group();
  readonly body: RigidBody3D;
  readonly buoyancy: Buoyancy3D;
  #capsized = false;
  #normaliseFactor: number;
  #heading = 0;
  /** Way on, in metres per second along the bow. The hull carries it; the keys only ask for it. */
  #speed = 0;
  /** What the hull is actually making good over the ground, measured off the body. */
  #groundSpeed = 0;
  /** The last fixed step, in seconds, for readers that are called without one. */
  #step = 1 / 60;
  /** Heel, eased. A ship leans away from its turn and to leeward under press of sail. */
  #heel = 0;
  /** The blade on the stern post, kept out of the merged hull so it can answer the helm. */
  readonly #rudder: Object3D | undefined;
  #elapsed = 0;
  #immersion = 0.5;
  #seaHeight = 0;
  #staleFrames = -1;
  readonly #ocean: SpectralOcean;

  constructor(ctx: GameCtx, ocean: SpectralOcean) {
    this.#ocean = ocean;
    this.mesh.position.set(0, 0.24, 7);
    this.visual.position.set(0, 0.24, 7);
    this.mesh.castShadow = true;
    const model = createShipModel(createMaterials());
    // Named in `props.ts`, found here. The rest of the hull is merged into one mesh per material
    // and cannot move; this is the piece that has to, because a helm with no visible rudder is
    // the difference between steering a ship and dragging a model around.
    this.#rudder = model.getObjectByName("rudder");
    this.#normaliseFactor = prepareShipConventions(model);
    // The design waterline is not the model's origin: the lofted hull is built about y = 0 with
    // its keel at -0.73 and its rail at +0.80, so floating the origin on the sea put the water
    // halfway up the topsides and the caravel photographed swamped to its wales with only the
    // castle showing. Lifting the model inside the visual moves the waterline down the hull
    // without moving the hull off the water — `floatGap` is measured on `visual`, and this does
    // not touch it.
    model.position.y = FREEBOARD_TRIM;
    // The hull hangs off `visual`, not off the physics body.
    //
    // `Buoyancy3D` applies its displaced-volume force at each hull point, so a point that is
    // deeper than its neighbour torques the body — which is right. What no game can reach is the
    // other half of that: Rapier's angular damping is not on `IRigidBody3DOptions`, and the drag
    // term inside `Buoyancy3D` is computed from the body's *linear* velocity, so it is identical
    // at every point and damps no rotation at all. The torque therefore accumulates with nothing
    // opposing it, and within a few seconds of spawning the ship is tumbling. It always was: the
    // template's own first frame showed the old model lying on its side, and that read as "the
    // boat is a plank" rather than as a boat rolled ninety degrees.
    //
    // So the body keeps the heave — that is what buoyancy is for and it is worth having — and the
    // attitude is read off the swell instead: three height samples around the hull give the pitch
    // and the roll, so the ship pitches into the face of a wave and rolls with the beam of it,
    // which is both stable and closer to what a boat does than a free-spinning rigid body ever was.
    this.visual.add(model);
    ctx.add(this.mesh);
    ctx.add(this.visual);

    this.body = new RigidBody3D({
      collisionLayer: 1,
      collisionMask: 0,
      mass: 420,
      object: this.mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.box(1.4, 0.7, 2.4),
    });
    this.buoyancy = new Buoyancy3D({
      body: this.body,
      density: 1_000,
      drag: 12,
      field: oceanSurface(ocean, () => this.#step),
      gravity: 9.81,
      // All four points sit **below** the body's centre, at the hull's bottom corners. Two of them
      // used to sit at +0.32 — above it — which puts buoyancy over the centre of mass at the stern
      // and gives the ship a standing moment it can only resolve by rolling onto its side. It did:
      // the template's own first frame showed the hull lying flat on the water with the sail
      // floating beside it, and that was read as "the boat is a plank" rather than as a capsize.
      hullPoints: [
        { position: [-0.45, -0.3, -0.75], volume: 0.275 },
        { position: [0.45, -0.3, -0.75], volume: 0.275 },
        { position: [-0.45, -0.3, 0.75], volume: 0.275 },
        { position: [0.45, -0.3, 0.75], volume: 0.275 },
      ],
      pointSpacing: 0.64,
      volume: 1.1,
    });
  }

  /** The unit vector the bow points along. The model's stem is at **-Z**, so both terms negate. */
  get forward(): { x: number; z: number } {
    return { x: -Math.sin(this.#heading), z: -Math.cos(this.#heading) };
  }

  /** The unit vector out over the starboard rail: the bow turned ninety degrees to the right. */
  get starboard(): { x: number; z: number } {
    return { x: Math.cos(this.#heading), z: -Math.sin(this.#heading) };
  }

  get heading(): number {
    return this.#heading;
  }

  /** Speed made good over the ground. This is the number the HUD shows. */
  get speed(): number {
    return this.#groundSpeed;
  }

  /** Speed the sails are asking for, before the water has its say. */
  get demandedSpeed(): number {
    return this.#speed;
  }

  /**
   * Steer a ship, rather than slide a box around the world axes.
   *
   * What this replaces drove the body's velocity straight from the input — `x` from the left and
   * right keys, `z` from forward — and then turned the *drawn* hull by a slow separate angle that
   * nothing else read. So the ship crabbed: it visibly pointed one way and travelled another, the
   * rudder had no effect on where it went, and the four course marks could be collected by
   * strafing past them broadside. The heading is now the only direction the ship can make way
   * along, which is what makes steering a mechanic instead of a decoration.
   */
  update(ctx: GameCtx, deltaTime: number, wind: number, touch?: ITouchInput): void {
    this.#elapsed += deltaTime;
    this.#step = deltaTime;
    // Two axes, read separately — see the binding comment in `game.ts` for why this is not
    // `vector("move")`. The touch stick *is* a stick, so it stays clamped and adds into both.
    const helm = ctx.input.vector("helm");
    const sheets = ctx.input.vector("sheets");
    const press = Math.max(0, Math.min(1, wind));
    // `sheets.y` is +up and means forward: the one conversion to the model's -Z bow happens in
    // `forward`, not here. Astern input spills the sails rather than driving the ship backwards —
    // a square rig cannot make sternway, so it reads as a brake.
    const throttle = MathUtils.clamp(sheets.y + (touch?.move.y ?? 0), -1, 1);
    const rudder = MathUtils.clamp(helm.x + (touch?.move.x ?? 0), -1, 1);
    const target = MAX_SPEED * press * Math.max(0, throttle);
    // Losing way is faster than gaining it when the sails are spilled, and much faster than the
    // hull's own drag would manage on its own.
    const rate = target < this.#speed ? WAY_RATE * (throttle < 0 ? 3.4 : 1.6) : WAY_RATE;
    this.#speed += (target - this.#speed) * Math.min(1, Math.max(0, deltaTime) * rate * 2);

    // A rudder is a foil: it only bites on water flowing past it. Standing still, the ship swings
    // slowly on its sails alone, and the floor keeps that from being a dead helm.
    const authority = Math.max(0.2, Math.min(1, this.#speed / (MAX_SPEED * 0.55)));
    this.#heading -= rudder * TURN_RATE * authority * deltaTime;

    const forward = this.forward;
    const velocity = this.body.linearVelocity;
    // Read **before** it is overwritten, so this is what the last physics step actually left the
    // hull doing rather than what the sails asked for. The two differ: `Buoyancy3D` applies a drag
    // term from the body's linear velocity, which opposes the drive horizontally as well as
    // vertically. Reporting the demanded speed as though it were the achieved one puts a number in
    // the HUD that the ship never makes good.
    this.#groundSpeed = Math.hypot(velocity.x, velocity.z);
    this.body.linearVelocity = {
      x: forward.x * this.#speed,
      // Heave stays the buoyancy solver's. Overwriting it here would be the game deciding how far
      // the sea can lift its own hull.
      y: velocity.y,
      z: forward.z * this.#speed,
    };

    // Heel: outward in a turn, and a constant lean to leeward under press of sail. Positive
    // `rotation.z` lifts the starboard rail, so a turn to starboard leans the ship to port.
    const heelTarget = rudder * authority * 0.17 + press * 0.05;
    this.#heel += (heelTarget - this.#heel) * Math.min(1, Math.max(0, deltaTime) * 2.4);
    // Hard over is about thirty-five degrees on a real ship, and the blade eases across rather
    // than snapping: a rudder that teleports between its stops is the tell that the helm is a
    // number rather than a thing hanging in the water.
    if (this.#rudder !== undefined) {
      const blade = -rudder * 0.6;
      this.#rudder.rotation.y += (blade - this.#rudder.rotation.y) * Math.min(1, deltaTime * 6);
    }
    this.#rideTheSwell(deltaTime);
  }

  /**
   * Read the swell under the ship and set the visual's attitude from it.
   *
   * Two samples a boat-length apart give the pitch, two across the beam give the roll. Both are
   * eased rather than snapped, so the ship lags the water the way a hull with mass does.
   */
  #rideTheSwell(deltaTime: number): void {
    if (this.#capsized) return;
    const { x, z } = this.mesh.position;
    // `SpectralOcean` has no closed form, so its CPU height is a throttled copy of what the GPU
    // produced and can be `undefined` until the first readback lands. Falling back to the mean
    // sea level for those frames is the whole handling this needs — a boat sitting flat at y = 0
    // for the first fraction of a second is invisible, and throwing is not.
    //
    // Every probe is taken **upwind** by however far the swell will have run during the copy's
    // age. `sampleHeight` hands back a height from a GPU copy that is `staleFrames` old, and a
    // hull floated straight onto that number rides water the renderer stopped drawing several
    // frames ago: the ship visibly cut down through a crest and hung above the following trough,
    // and the waterline reading swung between a third and two thirds of the hull between two
    // captures a second apart. Deep-water waves travel, so reading the stale field a little
    // upwind reads what this patch of sea is about to become.
    const heightAt = (sampleX: number, sampleZ: number): number =>
      surfaceHeight(this.#ocean, sampleX, sampleZ, deltaTime) ?? 0;
    // Sampled across the hull's real length and beam, not a token metre. The height copy is a
    // bilinear read of a grid about three metres across, so two probes closer together than that
    // largely describe the same cell and the ship barely responds to the swell it is in.
    //
    // Probed along the **ship's** axes, not the world's. Sampling a fixed north-south pair gave a
    // hull that pitched into swell it was running along the length of and rolled to seas it was
    // meeting head on: turn ninety degrees and the pitch and the roll swapped over. Rotating the
    // four probes by the heading is what makes the attitude belong to this ship rather than to
    // the compass.
    const forward = this.forward;
    const starboard = this.starboard;
    const aheadHeight = heightAt(x + forward.x * HALF_LENGTH, z + forward.z * HALF_LENGTH);
    const asternHeight = heightAt(x - forward.x * HALF_LENGTH, z - forward.z * HALF_LENGTH);
    const starboardHeight = heightAt(x + starboard.x * HALF_BEAM, z + starboard.z * HALF_BEAM);
    const portHeight = heightAt(x - starboard.x * HALF_BEAM, z - starboard.z * HALF_BEAM);
    const hereHeight = heightAt(x, z);
    this.#seaHeight = hereHeight;
    this.#staleFrames = this.#ocean.sampleHeight(x, z)?.staleFrames ?? -1;
    // The ship's bow is at **-Z**, so a positive `rotation.x` lifts it — which means the pitch is
    // driven by how much higher the water *ahead* is, not the water astern. Written the other way
    // round the bow rose over troughs and drove into the face of every wave, and the ship
    // photographed as though it were going under bow-first.
    //
    // Clamped, because the height field is a copy of a GPU buffer read on a grid coarser than the
    // hull: two probes can disagree by more than the sea actually does, and without a limit one
    // bad pair throws the ship onto its beam ends for a frame.
    const pitch = MathUtils.clamp(
      Math.atan2(aheadHeight - asternHeight, HALF_LENGTH * 2),
      -0.3,
      0.3,
    );
    // How deep the bow is in the water it is meeting. This is the number the HUD's waterline
    // shows: `Buoyancy3D.submergedFraction` measures its hull points through the body's own
    // quaternion, and with the body free to tumble that reading swings between 0 and 1 with
    // nothing to do with what the player can see.
    this.#immersion = Math.min(
      1,
      Math.max(0, 0.5 + (aheadHeight - this.visual.position.y) / DESIGN_DRAUGHT),
    );
    const roll =
      MathUtils.clamp(Math.atan2(starboardHeight - portHeight, HALF_BEAM * 2), -0.26, 0.26) +
      this.#heel;
    const blend = Math.min(1, Math.max(0, deltaTime) * 3.2);
    this.visual.position.x = this.mesh.position.x;
    this.visual.position.z = this.mesh.position.z;
    // The design waterline sits **on** the surface, not eased towards it.
    //
    // Easing at 3.2 per second is a third of a second of lag, and against a sea whose surface
    // rises at three metres a second that is nearly half a metre of hull hanging in the air over
    // its own trough — most of this ship's draught. A boat this size has no such lag: it is a
    // float, and a float is wherever the water is. The inertia that *is* real lives in the
    // attitude below, where a hull's mass genuinely resists being rolled.
    this.visual.position.y = hereHeight;
    // `YXZ`: yaw, then pitch and roll about the ship's **own** axes. In the default `XYZ` order
    // the pitch is applied in world space and the heel goes wherever the heading happens to point
    // it, so a ship on a westerly course rolled when it should have pitched.
    this.visual.rotation.order = "YXZ";
    this.visual.rotation.y = this.#heading;
    this.visual.rotation.x += (pitch - this.visual.rotation.x) * blend;
    this.visual.rotation.z += (roll - this.visual.rotation.z) * blend;
  }

  capsize(): void {
    if (this.#capsized) return;
    this.#capsized = true;
    this.visual.rotation.z = Math.PI / 2;
  }

  get capsized(): boolean {
    return this.#capsized;
  }

  /** Fraction of the hull the sea is over, from the swell the ship is actually sitting in. */
  get immersion(): number {
    return this.#capsized ? 1 : this.#immersion;
  }

  debug(): Record<string, unknown> {
    const velocity = this.body.linearVelocity;
    return {
      capsized: this.#capsized,
      linearVelocity: [velocity.x, velocity.y, velocity.z],
      normaliseFactor: this.#normaliseFactor,
      demandedSpeed: this.#speed,
      groundSpeed: this.#groundSpeed,
      position: this.mesh.position.toArray(),
      immersion: this.#immersion,
      // The three numbers a scenario needs to prove the ship is *floating* rather than merely
      // existing: the sea under it, how far the drawn hull sits off that surface, and whether the
      // height copy is arriving at all. A screenshot cannot tell a still ocean from a moving one.
      seaHeight: this.#seaHeight,
      floatGap: this.visual.position.y - this.#seaHeight,
      readbackStaleFrames: this.#staleFrames,
      oceanSteps: this.#ocean.steps,
      submergedFraction: this.buoyancy.submergedFraction,
    };
  }

  dispose(): void {
    this.body.dispose();
    this.mesh.removeFromParent();
    this.visual.removeFromParent();
  }
}
