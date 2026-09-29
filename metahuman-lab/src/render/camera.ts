import { type PerspectiveCamera, Vector3 } from "three";
import type { Framing, Vantage } from "./stage.js";
import { placeCamera } from "./stage.js";

/**
 * Orbit, zoom and pan around the face, with damping, limits and a way back.
 *
 * A face study needs to be *looked at*, and a lab whose camera can only stand where it was put is a
 * lab that can only be judged from the one angle its author liked. This is the smallest controller
 * that answers that: three degrees of freedom, a spring towards the goal so nothing snaps, and a
 * `frame()` that puts it all back.
 *
 * It reads the engine's own input rather than the DOM — `pointerRelative` bindings for the drag,
 * `scroll` and `pinch` for the zoom — so it works unchanged on the native web view, and it takes no
 * pointer lock, so a drag that starts over the expression panel belongs to the panel.
 */

/** How far the camera may leave the framing, as a multiple of the framed distance. */
const ZOOM_RANGE = { min: 0.62, max: 2.1 } as const;

/** How far it may turn. Past a quarter-turn the portrait canon stops reading as a portrait. */
const YAW_LIMIT = (72 * Math.PI) / 180;
const PITCH_RANGE = { min: (-38 * Math.PI) / 180, max: (46 * Math.PI) / 180 } as const;

/** Pixels of drag per radian of turn: a full-width drag sweeps about half the yaw range. */
const YAW_PER_PIXEL = (Math.PI / 2.4) / 1280;
const PITCH_PER_PIXEL = YAW_PER_PIXEL * 0.8;

/**
 * Damping, as a half-life in seconds rather than a per-frame fraction.
 *
 * A fixed `lerp(0.1)` is frame-rate dependent — twice as fast at 120 Hz — and a face that settles at
 * a different speed on every machine is a face whose framing cannot be reasoned about. Half-life is
 * the one form of this that means the same thing on all of them.
 */
const HALF_LIFE = 0.09;

/** Ceiling on a frame's delta, so a stalled tab does not fling the camera on resume. */
const MAX_STEP = 0.1;

/** A camera's goal pose: where the springs are pulling towards. */
interface Goal {
  yaw: number;
  pitch: number;
  zoom: number;
  panX: number;
  panY: number;
}

export class FaceCamera {
  readonly #camera: PerspectiveCamera;
  readonly #framing: Framing;
  readonly #current: Goal = { yaw: 0, pitch: 0, zoom: 1, panX: 0, panY: 0 };
  readonly #goal: Goal = { yaw: 0, pitch: 0, zoom: 1, panX: 0, panY: 0 };
  #vantage: Vantage;
  #stamp = 0;

  constructor(camera: PerspectiveCamera, framing: Framing, vantage: Vantage) {
    this.#camera = camera;
    this.#framing = framing;
    this.#vantage = vantage;
    this.frame();
  }

  /** The vantage the camera is heading back to, which is what the capture hook sets. */
  setVantage(vantage: Vantage): void {
    this.#vantage = vantage;
    this.frame();
  }

  /** Back to the framing's own vantage, pan and all. */
  frame(): void {
    this.#goal.yaw = this.#vantage.yaw;
    this.#goal.pitch = this.#vantage.pitch;
    // The vantage's own dolly and aim, which is what makes a close-up a close-up rather than a
    // portrait with a longer lens: `zoom` is the dolly the vantage asked for, and `panY` is its
    // share of the frame converted into the frame plane's own metres at that dolly.
    this.#goal.zoom = this.#vantage.dolly;
    this.#goal.panX = 0;
    this.#goal.panY = (this.#vantage.panY ?? 0) * this.#framing.visible * this.#vantage.dolly;
    // The opening pose is placed outright rather than sprung in from the origin: a lab that fades its
    // camera in from somewhere else on entry is a lab whose first frame is a transition, not a shot.
    Object.assign(this.#current, this.#goal);
    this.#stamp = 0;
    this.#place();
  }

  /** Turn, in the drag's own pixels. Yaw is about the head's up axis; pitch stops before the poles. */
  orbit(dx: number, dy: number): void {
    this.#goal.yaw = clamp(this.#goal.yaw - dx * YAW_PER_PIXEL, -YAW_LIMIT, YAW_LIMIT);
    this.#goal.pitch = clamp(this.#goal.pitch + dy * PITCH_PER_PIXEL, PITCH_RANGE.min, PITCH_RANGE.max);
  }

  /**
   * Pan, in the drag's own pixels.
   *
   * Scaled by the distance and by the frame's own aspect, so a drag moves the face the same number of
   * pixels on screen at any zoom — the alternative is a pan that travels further the closer you are,
   * which is the opposite of what a pan is for.
   */
  pan(dx: number, dy: number): void {
    const perPixel = (2 * this.#framing.visible * this.#goal.zoom) / 1280;
    this.#goal.panX = clamp(this.#goal.panX - dx * perPixel, -0.6, 0.6);
    this.#goal.panY = clamp(this.#goal.panY + dy * perPixel, -0.45, 0.45);
  }

  /** Wheel or pinch. Positive is toward the viewer, which is the DOM's own sign convention. */
  zoom(delta: number): void {
    this.#goal.zoom = clamp(this.#goal.zoom * Math.exp(-delta * 0.0016), ZOOM_RANGE.min, ZOOM_RANGE.max);
  }

  /**
   * Spring the camera one step towards the goal and place it.
   *
   * Returns whether anything moved, so a scene can skip the write on an idle frame — three skips the
   * per-object binding update when nothing changed, and a camera that rewrites an identical transform
   * is a camera that throws that away sixty times a second.
   */
  update(now: number): boolean {
    const step = this.#stamp === 0 ? 1 : 1 - Math.pow(0.5, Math.min(now - this.#stamp, MAX_STEP) / HALF_LIFE);
    this.#stamp = now;
    let moved = false;
    for (const key of ["yaw", "pitch", "zoom", "panX", "panY"] as const) {
      const delta = this.#goal[key] - this.#current[key];
      if (Math.abs(delta) < 1e-5) {
        if (this.#current[key] !== this.#goal[key]) moved = true;
        this.#current[key] = this.#goal[key];
        continue;
      }
      this.#current[key] += delta * step;
      moved = true;
    }
    if (moved) this.#place();
    return moved;
  }

  #place(): void {
    const distance = this.#framing.distance * this.#current.zoom;
    // Pan is applied in the *framing's* plane and in screen axes, then the whole offset is added
    // after the look, so panning never rolls the camera and never changes the angle it sees the face
    // from. The lens shift comes back too, or the face slides under the panel the moment it is panned.
    placeCamera(
      this.#camera,
      this.#framing,
      {
        yaw: this.#current.yaw,
        pitch: this.#current.pitch,
        dolly: this.#current.zoom,
      },
      TMP.set(this.#current.panX, this.#current.panY, 0),
    );
  }
}

const TMP = new Vector3();

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
