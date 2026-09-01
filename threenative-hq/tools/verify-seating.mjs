/**
 * Does the seated worker actually meet its furniture? `node tools/verify-seating.mjs`.
 *
 * Three contacts decide whether a worker reads as someone working: hips on the seat, hands on
 * the keys, feet near the floor. All three are one vertical offset apart, and all three are
 * invisible to every other gate in this project — a worker hovering 9 cm above its chair with
 * its hands passing over the keyboard passes typecheck, lint, and every playtest assertion.
 *
 * This applies the same landing the scene does (hips to the seat) and prints what the rest of
 * the body does about it, in centimetres.
 */
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { normaliseToMetres } from "@threenative/core";
import { AnimationMixer, Group, Vector3 } from "three";
import { readFileSync } from "node:fs";

/** Kept in step with src/render/office.ts by hand; the numbers this file judges. */
const SEAT_HEIGHT = 0.49;
const DESK_HEIGHT = 0.72;
const DESK_SURFACE = DESK_HEIGHT + 0.025;
// Desk surface, plus the keyboard's own tray and keycap heights from src/render/keyboard.ts
// (PLATE_HEIGHT 0.017, CAP_HEIGHT 0.009). Same 0.771 the two-box board happened to land on,
// but derived from the geometry that is actually in the scene now.
const KEY_TOP = DESK_SURFACE + 0.017 + 0.009;
/** A hand bone sits about this far above the keys when the fingers are on them. */
const HAND_OVER_KEYS = 0.02;

const arrayBuffer = (path) => {
  const b = readFileSync(path);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
const rig = await new GLTFLoader().parseAsync(arrayBuffer("assets/worker.glb"), "");
const lib = await new GLTFLoader().parseAsync(arrayBuffer("assets/worker-mixamo.glb"), "");

// The scene's own arrangement: a body the game moves, with the normalised rig under it.
const body = new Group();
normaliseToMetres(rig.scene, { metres: 1.8, axis: "height" });
body.add(rig.scene);

const world = (name) => new Vector3().setFromMatrixPosition(body.getObjectByName(name).matrixWorld);
const cm = (metres) => `${(metres * 100).toFixed(1)} cm`;

let failures = 0;
for (const name of ["Typing_Loop", "Sitting_Idle_Loop", "Sitting_Talking_Loop"]) {
  const clip = lib.animations.find((c) => c.name === name) ?? rig.animations.find((c) => c.name === name);
  if (clip === undefined) continue;
  const mixer = new AnimationMixer(rig.scene);
  mixer.clipAction(clip).play();
  mixer.update(4);
  body.position.y = 0;
  body.updateMatrixWorld(true);
  // The scene's landing: drop the body so the clip's hips arrive on the seat.
  const onSeat = SEAT_HEIGHT - (world("pelvis").y - body.position.y);
  const footRise = Math.min(world("foot_l").y, world("foot_r").y) - body.position.y;
  const clamped = -footRise > onSeat;
  body.position.y = Math.max(onSeat, -footRise);
  body.updateMatrixWorld(true);

  const hips = world("pelvis").y - SEAT_HEIGHT;
  const hands = (world("hand_l").y + world("hand_r").y) / 2;
  const overKeys = hands - KEY_TOP;
  const feet = Math.min(world("foot_l").y, world("foot_r").y);
  const typing = name === "Typing_Loop";
  const handsOk = !typing || Math.abs(overKeys - HAND_OVER_KEYS) < 0.03;
  // Two-sided on purpose. A one-sided "below 9 cm" check passes feet sunk INTO the carpet, which
  // is the same defect as dangling and just as visible from across the room.
  const feetOk = feet < 0.09 && feet > -0.005;
  // A clamped pose is allowed to hold its hips clear of the seat, because the alternative is
  // shoes inside the carpet — but only just clear. Three centimetres is where a gap under a
  // seated worker stops reading as a cushion and starts reading as a bug, so the allowance is
  // bounded and named rather than folded into a wider tolerance that would hide a real drift.
  const hipLimit = clamped ? 0.03 : 0.01;
  const hipsOk = Math.abs(hips) <= hipLimit;
  if (!handsOk || !feetOk || !hipsOk) failures += 1;
  console.log(`${name}
  hips vs seat   ${cm(hips)}  ${hipsOk ? (clamped ? "ok, yielded to the floor clamp" : "ok") : "FLOATING"}
  hands vs keys  ${cm(overKeys)} above  ${handsOk ? "ok" : typing ? "NOT TYPING" : "n/a"}
  feet vs floor  ${cm(feet)}  ${feetOk ? "ok" : feet < 0 ? "THROUGH THE FLOOR" : "DANGLING"}
  desk surface   ${cm(DESK_SURFACE)}, key tops ${cm(KEY_TOP)}`);
}
console.log(failures === 0 ? "\nSEATING OK" : `\nSEATING FAILED (${String(failures)} pose(s))`);
process.exit(failures === 0 ? 0 : 1);
