// The one place a real-world size is declared.
//
// One metre is one metre. Everything that builds or measures a physical object imports
// from here: the game so it renders at the right size, and `tools/scale-audit.mjs` so a
// mismatch fails a command instead of hiding in a screenshot. A model that arrives in
// centimetres is normalised on load — never accommodated by tuning a literal beside it.
//
// This file is why the 2.68 m soldier, the 1.19 m AK and the 1.43 m viewmodel cannot
// come back: there is no second place to write a size.

/** Real-world sizes, in metres. */
export const scale = {
  /** Adult soldier, boots to head-top. */
  humanHeight: 1.78,
  /** Eye above the deck, standing. */
  eyeHeight: 1.66,
  /** Shoulder width; sets the hitbox width and depth. */
  shoulderWidth: 0.5,
  /** Body depth front to back. */
  bodyDepth: 0.32,
  /** AK-pattern rifle, muzzle to stock. */
  rifleLength: 0.88,
  /** Man-size range silhouette. */
  silhouette: { width: 0.5, height: 1.8 },
  /** Steel personnel locker. */
  locker: { width: 0.9, height: 1.85, depth: 0.5 },
  /** Jersey-type concrete barricade. */
  barricade: { height: 1.0, depth: 0.6 },
  /** Perimeter wall. */
  wallHeight: 5.5,
  /** Handrail above its walking surface. */
  handrailHeight: 1.0,
  /** Visible muzzle flame. */
  muzzleFlash: 0.3,
} as const;

/** Which measured dimension a check reads. */
export type SizeAxis = "height" | "width" | "depth" | "longest";

/**
 * One rule the audit enforces.
 *
 * `band` pins a size within a fraction either way; `max` only forbids oversize, for
 * things that are legitimately allowed to vary downward (a head plate is a small
 * silhouette, but no silhouette may be taller than a person); `match` pins one subject to
 * another *measured* subject rather than to a number.
 *
 * `match` exists because the first run of this audit passed the enemy hitbox — 1.8 m sits
 * comfortably inside the human band — while the soldier it is supposed to wrap measured
 * 2.678 m. An absolute band cannot see that: only the relationship can.
 */
export type SizeCheck = {
  /** `Object3D.name` the audit looks for, or a synthetic key the audit supplies. */
  readonly subject: string;
  readonly axis: SizeAxis;
  /** The declared size. Ignored for `match`, which reads `reference` instead. */
  readonly metres: number;
  /** Fractional tolerance for `band` and `match`; ignored for `max`. */
  readonly tolerance?: number;
  readonly kind: "band" | "max" | "match";
  /** For `match`: the subject whose measured size this one must equal. */
  readonly reference?: string;
  /** Every subject must be found. Set only for things that may legitimately be absent. */
  readonly optional?: boolean;
  readonly note?: string;
};

export const SCALE_EXPECTATIONS: readonly SizeCheck[] = [
  {
    subject: "enemy",
    axis: "height",
    metres: scale.humanHeight,
    tolerance: 0.06,
    kind: "band",
    note: "bone-accurate head-top, not a bind-pose box",
  },
  {
    subject: "enemy-weapon",
    axis: "longest",
    metres: scale.rifleLength,
    tolerance: 0.12,
    kind: "band",
  },
  {
    subject: "player-viewmodel",
    axis: "longest",
    metres: scale.rifleLength,
    tolerance: 0.15,
    kind: "band",
    note: "a viewmodel may be read slightly large, but not a different weapon",
  },
  {
    subject: "player",
    axis: "height",
    metres: scale.humanHeight,
    tolerance: 0.06,
    kind: "band",
  },
  {
    // The hitbox is what the player actually shoots at, so it is checked against the body
    // it wraps, not against the human band — a hitbox that is right in the abstract and
    // wrong about this model is the bug that made headshots impossible.
    subject: "enemy-hitbox",
    axis: "height",
    metres: scale.humanHeight,
    reference: "enemy",
    tolerance: 0.06,
    kind: "match",
    note: "must equal the rendered enemy height",
  },
  { subject: "target-plate", axis: "height", metres: scale.silhouette.height, kind: "max" },
  { subject: "target-plate", axis: "width", metres: scale.silhouette.width * 1.5, kind: "max" },
  { subject: "locker", axis: "height", metres: scale.locker.height, tolerance: 0.15, kind: "band" },
  { subject: "barricade", axis: "depth", metres: scale.barricade.depth, kind: "max" },
  { subject: "wall", axis: "height", metres: scale.wallHeight, tolerance: 0.1, kind: "band" },
  { subject: "muzzle-flash", axis: "longest", metres: scale.muzzleFlash, kind: "max" },
];
