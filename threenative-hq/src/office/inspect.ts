import type { Object3D, PerspectiveCamera, Vector3 } from "three";
import { Vector3 as Vec3 } from "three";

/**
 * A numeric window into the scene, for whoever is debugging it — usually an agent.
 *
 * `doctor --url --text` already answers "is anything on screen, what is registered, which clip is
 * playing". What it cannot answer is "where is this thing relative to that thing", and that is the
 * question every layout bug turns out to be: a keyboard four centimetres inside a desk, a camera
 * inside a shoulder, feet under the floor. Screenshots answer it slowly and expensively; this
 * answers it in numbers.
 *
 * Published on `window.__hq` on web only, and read by `tools/inspect.mjs`.
 */
export interface IInspectorProbe {
  readonly frames: number;
  readonly dt: number;
  readonly actors: readonly IActorReport[];
  readonly camera: { x: number; y: number; z: number; pitch: number; yaw: number };
  readonly checks: readonly ICheck[];
}

export interface ICameraReport {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly pitch: number;
  readonly yaw: number;
}

export interface IActorReport {
  readonly id: string;
  readonly phase: string;
  readonly state: string;
  readonly clip: string;
  readonly advancedFrames: number;
  readonly clipAge: number;
  readonly stateChanges: number;
  readonly settled: boolean;
  readonly transitioning: boolean;
  readonly position: readonly [number, number, number];
  readonly hand: readonly [number, number, number] | undefined;
  readonly keyboard: readonly [number, number, number] | undefined;
  /** The keyboard's position inside its desk, which is what the alignment actually writes. */
  readonly boardLocal: readonly [number, number, number] | undefined;
  readonly deskIndex: number;
}

export interface ICheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

const SCRATCH = new Vec3();

export function worldOf(object: Object3D | undefined): readonly [number, number, number] | undefined {
  if (object === undefined) return undefined;
  object.updateWorldMatrix(true, false);
  const at = SCRATCH.setFromMatrixPosition(object.matrixWorld);
  return [round(at.x), round(at.y), round(at.z)];
}

export function vectorOf(at: Vector3): readonly [number, number, number] {
  return [round(at.x), round(at.y), round(at.z)];
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Derived answers, so the caller reads a verdict rather than doing arithmetic on a dump. */
export function deriveChecks(
  actors: readonly IActorReport[],
  camera: PerspectiveCamera,
  visitor: ICameraReport,
): ICheck[] {
  const checks: ICheck[] = [];
  // Working first: a keyboard is only supposed to be under the hands of someone using it, and a
  // report that fills up with idle desks buries the one row that matters.
  // Only workers actually using a keyboard: an idle one has its hands in its lap on purpose.
  const seated = actors
    .filter((actor) => actor.phase === "seated" && actor.state === "working")
    .sort((a, b) => Number(b.state === "working") - Number(a.state === "working"));
  for (const actor of seated.slice(0, 4)) {
    const { hand, keyboard } = actor;
    if (hand === undefined || keyboard === undefined) continue;
    const dy = hand[1] - keyboard[1];
    const flat = Math.hypot(hand[0] - keyboard[0], hand[2] - keyboard[2]);
    checks.push({
      // Horizontal only. The driving pose holds the hands about a quarter of a metre above any
      // desk and no clip in this library does better; what the office controls is whether the
      // keyboard is under them, and that is what this measures.
      detail: `${actor.id} ${actor.clip}: hands ${flat.toFixed(3)} m from the keys across, ${dy >= 0 ? "+" : ""}${dy.toFixed(3)} m above`,
      name: "keyboard-under-hands",
      ok: flat <= 0.2,
    });
  }
  const stuck = actors.filter((actor) => actor.transitioning);
  checks.push({
    detail: stuck.length === 0 ? "every worker is in its state's own clip" : `${String(stuck.length)} mid-transition: ${stuck.map((a) => `${a.id}=${a.clip}`).join(", ")}`,
    name: "no-stuck-transitions",
    ok: stuck.length === 0,
  });
  const advancing = actors.filter((actor) => actor.advancedFrames > 0).length;
  checks.push({
    detail: `${String(advancing)}/${String(actors.length)} mixers advanced a frame`,
    name: "mixers-advancing",
    ok: actors.length === 0 || advancing > 0,
  });
  checks.push({
    detail: `camera at ${camera.position.y.toFixed(2)} m`,
    name: "camera-at-eye-height",
    ok: camera.position.y > 1.2 && camera.position.y < 2.1,
  });
  return checks;
}
