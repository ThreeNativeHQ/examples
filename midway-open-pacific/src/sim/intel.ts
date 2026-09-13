/**
 * One contact report and the pure estimates drawn from it. A contact is a belief, not the target:
 * it carries the fleet that holds the report, the observer that filed it, and an uncertain position
 * that only dead-reckoning can advance. `Battle` owns every mutation and every random draw; this
 * module never touches either, so the same call always answers the same.
 */
import { distance2 } from "./math.js";

export type Team = "us" | "ijn";
export type Classification = "unknown" | "aircraft" | "small" | "escort" | "cruiser" | "carrier" | "submarine";

export interface Contact {
  /** Stable id for this contact track. */
  id: string;
  /** The team that holds this report, not the team observed. */
  team: Team;
  observerId: string;
  /** The observed entity's id. Internal truth, never shown to the player. */
  targetId: string;
  observedAt: number;
  /** Battle.time seconds when the report reaches the fleet. */
  deliveredAt: number;
  x: number;
  z: number;
  heading: number;
  speed: number;
  /** Metres of positional uncertainty at observedAt. */
  errorRadius: number;
  classification: Classification;
  confidence: number;
  /** Contact broken; position must be extrapolated. */
  lost: boolean;
}

export interface ContactInit {
  id: string;
  team: Team;
  observerId: string;
  targetId: string;
  observedAt: number;
  delay: number;
  x: number;
  z: number;
  heading: number;
  speed: number;
  errorRadius?: number;
  classification?: Classification;
  confidence?: number;
  lost?: boolean;
}

/** A report older than this no longer counts as a fresh sighting. */
export const STALE_SECONDS = 240;
/** Dead-reckoned uncertainty grows this many metres per second of age. */
export const DRIFT_RATE = 5;
/** At or beyond this range every classification has decayed to unknown. */
export const CLASSIFY_RANGE = 9000;
/** The horizon distance constant: km per sqrt(metre) of height. */
const HORIZON_KM = 3.57;

export function makeContact(args: ContactInit): Contact {
  return {
    id: args.id,
    team: args.team,
    observerId: args.observerId,
    targetId: args.targetId,
    observedAt: args.observedAt,
    deliveredAt: args.observedAt + args.delay,
    x: args.x,
    z: args.z,
    heading: args.heading,
    speed: args.speed,
    errorRadius: args.errorRadius ?? 0,
    classification: args.classification ?? "unknown",
    confidence: args.confidence ?? 1,
    lost: args.lost ?? false,
  };
}

export function contactAge(contact: Contact, now: number): number {
  return now - contact.observedAt;
}

export function isDelivered(contact: Contact, now: number): boolean {
  return now >= contact.deliveredAt;
}

/**
 * Dead-reckon the estimate along the reported course. Uncertainty only ever grows: a lost contact
 * drifts three times as fast, because nobody is correcting it.
 */
export function estimatePosition(
  contact: Contact,
  now: number,
  drift = DRIFT_RATE,
): { x: number; z: number; radius: number } {
  const age = contactAge(contact, now);
  const reach = contact.speed * age;
  return {
    x: contact.x + Math.sin(contact.heading) * reach,
    z: contact.z - Math.cos(contact.heading) * reach,
    radius: contact.errorRadius + drift * age * (contact.lost ? 3 : 1),
  };
}

export function isStale(contact: Contact, now: number, maxAge: number): boolean {
  return contactAge(contact, now) > maxAge;
}

export interface ObserveArgs {
  observer: { x: number; z: number };
  target: { x: number; z: number };
  observerAltitude: number;
  /** Negative for a submerged submarine. */
  targetAltitude: number;
  rangeLimit: number;
  /** 0..1; zero visibility blinds the observer completely. */
  visibility: number;
  sightDepth: number;
}

/** Horizon distance in metres, from the observer and target heights above the sea. */
function horizonMetres(observerAltitude: number, targetAltitude: number): number {
  return (HORIZON_KM * Math.sqrt(Math.max(0, observerAltitude)) + HORIZON_KM * Math.sqrt(Math.max(0, targetAltitude))) * 1000;
}

export function canObserve(args: ObserveArgs): boolean {
  if (args.visibility <= 0) return false;
  if (args.targetAltitude < -args.sightDepth) return false;
  const range = distance2(args.observer, args.target);
  if (range > args.rangeLimit) return false;
  return range <= horizonMetres(args.observerAltitude, args.targetAltitude);
}

export interface ClassifyArgs {
  truth: Classification;
  range: number;
  /** 0..1, supplied by Battle's seeded generator so this function stays deterministic. */
  random: number;
  maxRange?: number;
}

const LADDER: Classification[] = ["carrier", "cruiser", "escort", "small", "unknown"];

/** Aircraft and submarines are not ship types, so their first fallback is a small contact. */
function ladderIndex(c: Classification): number {
  const i = LADDER.indexOf(c);
  return i < 0 ? LADDER.length - 2 : i;
}

/**
 * Degrade a true classification with range. A near contact is reported honestly; distance steps it
 * down the ladder toward unknown and confidence falls with it. The caller supplies the random draw,
 * because all randomness belongs to the simulation.
 */
export function classify(args: ClassifyArgs): { classification: Classification; confidence: number } {
  const truth = args.truth;
  const t = Math.min(1, Math.max(0, args.range / (args.maxRange ?? CLASSIFY_RANGE)));
  const maxSteps = LADDER.length - 1 - ladderIndex(truth);
  const steps = Math.min(maxSteps, Math.floor(t * LADDER.length + args.random));
  const index = Math.min(LADDER.length - 1, ladderIndex(truth) + steps);
  return {
    classification: steps === 0 ? truth : LADDER[index],
    confidence: Math.min(1, Math.max(0.05, 1 - 0.75 * t - 0.08 * steps)),
  };
}

export function mergeContact(existing: Contact, incoming: Contact): Contact {
  if (incoming.observedAt > existing.observedAt) return incoming;
  if (incoming.observedAt < existing.observedAt) return existing;
  return incoming.errorRadius <= existing.errorRadius ? incoming : existing;
}
