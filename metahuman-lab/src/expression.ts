/**
 * The expression model: the recipes, the demo timeline, the procedural channels, and the one rule
 * that decides which of them owns a channel on a given frame.
 *
 * Everything here is a pure function of its arguments. Nothing reads a clock, nothing holds a value
 * between calls, and nothing touches Three.js — which is what makes "the same time gives the same
 * pose" a property of the code rather than a hope about it.
 */

/** The lab's control vector, by declared alias. */
export type IVector = Readonly<Record<string, number>>;

/** Each channel's legal range, straight from the sidecar. */
export type IDomains = Readonly<Record<string, readonly [number, number]>>;

/**
 * The five recipes. Names for what the face does, not for what it is said to feel.
 *
 * `neutral` is `null` rather than an empty object on purpose: it is the one recipe that names every
 * channel, at its declared default, so `withPreset` can tell "return the face to neutral" from "a
 * recipe that happens to name nothing" and `reset` can be a preset button.
 */
export const PRESETS = {
  neutral: null,
  smile: {
    smileL: 0.85, smileR: 0.85,
    cheekRaiseL: 0.45, cheekRaiseR: 0.45,
    browRaiseOuterL: 0.15, browRaiseOuterR: 0.15,
  },
  frown: {
    frownL: 0.8, frownR: 0.8,
    browLowerL: 0.6, browLowerR: 0.6,
    browRaiseInnerL: 0.25, browRaiseInnerR: 0.25,
  },
  surprise: {
    jawOpen: 0.7,
    browRaiseInnerL: 0.9, browRaiseInnerR: 0.9,
    browRaiseOuterL: 0.75, browRaiseOuterR: 0.75,
    lipFunnelUpperL: 0.35, lipFunnelUpperR: 0.35,
  },
  anger: {
    browLowerL: 0.9, browLowerR: 0.9,
    frownL: 0.45, frownR: 0.45,
    squintL: 0.3, squintR: 0.3,
    mouthCloseUpperL: 0.3, mouthCloseUpperR: 0.3,
  },
} as const;

export type PresetName = keyof typeof PRESETS;

/** The channels each automation owns, and therefore the channels a manual edit switches it off. */
export const BLINK_CHANNELS = ["blinkL", "blinkR"] as const;
export const GAZE_CHANNELS = [
  "gazeHorizontalL", "gazeHorizontalR", "gazeVerticalL", "gazeVerticalR",
] as const;

/**
 * The demonstration sequence, as keyframes in control space.
 *
 * Time-based and nothing else: `demoAt(t)` is the pose at `t` for every `t`, however the face got
 * there, which is the whole of what "scrubbing is deterministic" means. The last keyframe repeats
 * the first, so playback loops without a seam.
 */
const DEMO_KEYS: readonly (readonly [number, IVector])[] = [
  [0, {}],
  [0.7, { jawOpen: 0.55 }],
  [1.5, { jawOpen: 0.1, smileL: 0.9, smileR: 0.9, cheekRaiseL: 0.45, cheekRaiseR: 0.45 }],
  [2.3, { jawOpen: 0.35, browRaiseInnerL: 0.85, browRaiseInnerR: 0.85, browRaiseOuterL: 0.7, browRaiseOuterR: 0.7 }],
  [3.1, { frownL: 0.8, frownR: 0.8, browLowerL: 0.6, browLowerR: 0.6 }],
  [3.9, { jawOpen: 0.7, browRaiseInnerL: 0.9, browRaiseInnerR: 0.9, lipFunnelUpperL: 0.35, lipFunnelUpperR: 0.35 }],
  [4.7, { browLowerL: 0.9, browLowerR: 0.9, squintL: 0.4, squintR: 0.4, mouthCloseUpperL: 0.3, mouthCloseUpperR: 0.3 }],
  [6, {}],
];

export const DEMO_DURATION = DEMO_KEYS[DEMO_KEYS.length - 1]![0];

/** The pose at `t`: linear between the two keyframes that bracket it, clamped to the sequence. */
export function demoAt(t: number): Record<string, number> {
  const time = Math.min(Math.max(t, 0), DEMO_DURATION);
  let index = 0;
  while (index < DEMO_KEYS.length - 2 && DEMO_KEYS[index + 1]![0] < time) index += 1;
  const [from, start] = DEMO_KEYS[index]!;
  const [to, end] = DEMO_KEYS[index + 1]!;
  const span = to - from;
  const step = span <= 0 ? 1 : (time - from) / span;
  const out: Record<string, number> = { ...start };
  for (const alias of Object.keys(end)) {
    const from_ = start[alias] ?? 0;
    out[alias] = from_ + ((end[alias] ?? 0) - from_) * step;
  }
  return out;
}

/** A blink lid curve: 0 at both ends of the window, 1 in the middle, 0 outside it. */
function pulse(t: number, period: number, at: number, width: number): number {
  const phase = (((t - at) % period) + period) % period;
  return phase > width ? 0 : Math.sin((phase / width) * Math.PI);
}

const BLINK_PERIOD = 4.2;

/** Procedural blinking: a double blink, a pause, a single blink, then the loop. */
export function blinkAt(t: number): number {
  return Math.max(
    pulse(t, BLINK_PERIOD, 0.4, 0.13),
    pulse(t, BLINK_PERIOD, 0.62, 0.13),
    pulse(t, BLINK_PERIOD, 2.6, 0.15),
  );
}

/**
 * Procedural gaze: two slow sines, conjugate on both eyes.
 *
 * Horizontal is signed because the specimen declares it −1..1; vertical is not, so it rides inside
 * 0..1 rather than being clamped into it at the edge of the range every half cycle.
 */
export function gazeAt(t: number): { readonly horizontal: number; readonly vertical: number } {
  return { horizontal: 0.35 * Math.sin(t * 0.55), vertical: 0.25 + 0.15 * Math.sin(t * 0.37 + 1.1) };
}

/** Everything that decides who owns a channel this frame. */
export interface IOwnership {
  /** What the sliders have said — the vector a face is at when nothing else is acting. */
  readonly manual: IVector;
  /** Playback's base vector, or `undefined` when playback is not engaged. */
  readonly demo: IVector | undefined;
  readonly blink: boolean;
  readonly gaze: boolean;
  /** The clock the automations and the demo read. Seconds, from the scene's own entry. */
  readonly t: number;
  readonly domains: IDomains;
}

/**
 * A recipe written over a base vector, which is the whole of what choosing a preset is.
 *
 * **A recipe is an edit, not an owner.** It is applied to the base the moment it is chosen, so a
 * slider moved afterwards is on top of the recipe rather than under it. The alternative — keeping
 * the recipe as a layer `resolve` re-applies every frame — froze the face outright: the lab starts on
 * `neutral`, whose "recipe" is every channel at its declared default, so the layer overwrote each
 * manual edit on the very next frame and no slider, click or key press ever reached the rig. That is
 * exactly what this rewrite is the fix for, and why the recipe lives here instead of in `resolve`.
 *
 * `neutral` is the one recipe that names *every* channel, because it is a pose the lab returns to and
 * `reset` is this same call. Any other recipe touches only the channels it names, so it blends over
 * whatever the sliders already said.
 */
export function withPreset(
  base: IVector,
  preset: PresetName,
  intensity: number,
  defaults: IVector,
): Record<string, number> {
  const recipe = PRESETS[preset];
  if (recipe === null) return { ...defaults };
  const out: Record<string, number> = { ...base };
  for (const [alias, value] of Object.entries(recipe)) out[alias] = value * intensity;
  return out;
}

/**
 * The precedence rule, in one block, because it is the thing this lab is actually proving.
 *
 * Lowest to highest: the demo's base vector when playback is engaged, then the manual vector, then
 * each enabled automation over the channels it owns. Everything is clamped into the declared domain
 * here rather than at the handle, so an authored recipe can never arrive as a `TN_MH_BAD_DOMAIN`
 * throw from a face that was merely described a little loosely.
 */
export function resolve({ manual, demo, blink, gaze, t, domains }: IOwnership): Record<string, number> {
  const out: Record<string, number> = { ...(demo ?? manual) };
  if (blink) {
    const lid = blinkAt(t);
    for (const alias of BLINK_CHANNELS) out[alias] = lid;
  }
  if (gaze) {
    const aim = gazeAt(t);
    for (const alias of GAZE_CHANNELS)
      out[alias] = /horizontal/i.test(alias) ? aim.horizontal : aim.vertical;
  }
  for (const [alias, value] of Object.entries(out)) {
    const domain = domains[alias];
    if (domain !== undefined) out[alias] = Math.min(Math.max(value, domain[0]), domain[1]);
  }
  return out;
}

/** One step of a transition: `elapsed / duration`, and exactly 1 once it is over. */
export function rampStep(elapsed: number, duration: number): number {
  if (duration <= 0) return 1;
  return Math.min(Math.max(elapsed / duration, 0), 1);
}

/* --------------------------------------------------------------------------- the pose file ---- */

/** The versioned envelope. Anything else is refused rather than guessed at. */
export interface IPoseFile {
  readonly schema: "metahuman-lab/pose";
  readonly version: 1;
  /** SHA-256 of the head DNA: which specimen this pose was taken from. */
  readonly specimen: string;
  /** A hash of the declared control table: which face this pose was written against. */
  readonly profile: string;
  readonly controls: Record<string, number>;
}

export const POSE_SCHEMA = "metahuman-lab/pose";

/**
 * A stable hash of the declared control table.
 *
 * FNV-1a, not a cryptographic digest: it is a guard against a sidecar that declared different
 * channels under the same specimen, and the specimen itself is pinned by a real SHA-256. Printed as
 * sixteen hex characters from two differently-seeded passes so the string length is stable.
 */
export function profileHash(controls: readonly { alias: string; gui: string; min: number; max: number; default: number }[]): string {
  const text = controls.map((entry) => `${entry.alias}|${entry.gui}|${entry.min}|${entry.max}|${entry.default}`).join("\n");
  const pass = (seed: number): string => {
    let hash = seed;
    for (let at = 0; at < text.length; at += 1)
      hash = Math.imul(hash ^ text.charCodeAt(at), 0x01000193) >>> 0;
    return hash.toString(16).padStart(8, "0");
  };
  return `${pass(0x811c9dc5)}${pass(0x27d4eb2d)}`;
}

export function writePose(specimen: string, profile: string, controls: IVector): string {
  const file: IPoseFile = { schema: POSE_SCHEMA, version: 1, specimen, profile, controls: { ...controls } };
  return `${JSON.stringify(file, null, 2)}\n`;
}

/**
 * Parse a pose and hand back a vector the specimen can actually be given.
 *
 * Every rejection names the reason, because the alternative — a face that quietly loads somebody
 * else's smile — is the failure this whole check exists to prevent.
 */
export function readPose(
  text: string,
  identity: { readonly specimen: string; readonly profile: string; readonly domains: IDomains },
): Record<string, number> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`that is not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof parsed !== "object" || parsed === null) throw new Error("a pose must be a JSON object");
  const file = parsed as Partial<IPoseFile>;
  if (file.schema !== POSE_SCHEMA)
    throw new Error(`unsupported pose format '${String(file.schema)}'; this lab reads '${POSE_SCHEMA}'`);
  if (file.version !== 1) throw new Error(`unsupported pose version ${String(file.version)}; this lab reads version 1`);
  if (file.specimen !== identity.specimen)
    throw new Error(
      `this pose was taken from another specimen (DNA ${String(file.specimen).slice(0, 12)}…, ` +
        `this head is ${identity.specimen.slice(0, 12)}…)`,
    );
  if (file.profile !== identity.profile)
    throw new Error("this pose was written against a different control profile; re-save it from this lab");
  const controls = file.controls;
  if (typeof controls !== "object" || controls === null) throw new Error("the pose carries no control vector");
  const out: Record<string, number> = {};
  for (const [alias, value] of Object.entries(controls)) {
    const domain = identity.domains[alias];
    if (domain === undefined) throw new Error(`the pose names '${alias}', which this specimen does not declare`);
    if (typeof value !== "number" || !Number.isFinite(value))
      throw new Error(`the pose gives ${alias} as ${String(value)}, which is not a number`);
    if (value < domain[0] || value > domain[1])
      throw new Error(`the pose gives ${alias} as ${value}, outside this specimen's [${domain[0]}, ${domain[1]}]`);
    out[alias] = value;
  }
  return out;
}
