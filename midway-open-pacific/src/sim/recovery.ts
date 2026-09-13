/**
 * Getting the aircraft home. Pure geometry over the carrier's own moving frame: the H action, the
 * autopilot's navigation point, the L gate and the HUD's approach cues all read this one module,
 * so the guidance the player is shown and the eligibility the game enforces cannot drift apart.
 */
import { DECK_HEIGHT } from "./flight.js";
import { angleDelta, clamp, distance2, forward, localPoint } from "./math.js";

type Any = any;

/** The existing assisted-final envelope. These are the limits `assistRecovery` has always used. */
export const FINAL = Object.freeze({
  range: 700,
  minAltitude: 24,
  maxAltitude: 180,
  maxSpeed: 72,
  lateral: 100,
  heading: 0.4,
});

/** Where the approach is flown from: on the centreline, astern of the moving deck. */
export const SETUP = Object.freeze({
  astern: 1600,
  /** Inside the existing L envelope (24-180 m), so the groove starts where the assist can take it. */
  altitude: 150,
  transitAltitude: 350,
  capture: 2600,
});

/** Seconds of manoeuvring held back from the reserve estimate. A game estimate, not a fuel plan. */
export const MANOEUVRE_RESERVE = 120;

export type Phase = "none" | "transit" | "setup" | "groove" | "final";

export interface IApproach {
  carrier: Any;
  phase: Phase;
  /** Where the autopilot should steer, and the altitude it should hold there. */
  point: { x: number; z: number };
  altitude: number;
  ready: boolean;
  cues: string[];
  range: number;
  astern: number;
  lateral: number;
  headingError: number;
  speed: number;
  descent: number;
}

/** The astern setup point in the carrier's frame, so it moves with the ship. */
export function setupPoint(s: Any): { x: number; z: number } {
  const f = forward(s.heading);
  return { x: s.x - f.x * SETUP.astern, z: s.z - f.z * SETUP.astern };
}

/** Nearest friendly deck that can still take an aircraft. `null` when none can. */
export function recoveryDeck(ships: Any[], p: Any, minDeck: number): Any {
  return (
    ships
      .filter((s: Any) => s.team === "us" && s.kind === "carrier" && !s.sunk && s.deck > minDeck)
      .sort((a: Any, b: Any) => distance2(a, p) - distance2(b, p))[0] ?? null
  );
}

/**
 * The single assisted-final gate. `assistRecovery` and the HUD's "ready for L" cue both call this,
 * so the cue can never promise an approach the game will reject.
 */
export function finalReady(p: Any, s: Any): boolean {
  if (!s || s.sunk || p.mode !== "flight" || !p.gear) return false;
  const local = localPoint(p, s);
  return (
    distance2(p, s) < FINAL.range &&
    local.forward < 0 &&
    p.y > FINAL.minAltitude &&
    p.y < FINAL.maxAltitude &&
    p.speed < FINAL.maxSpeed &&
    Math.abs(local.right) < FINAL.lateral &&
    Math.abs(angleDelta(p.heading, s.heading)) < FINAL.heading
  );
}

/**
 * Route, phase and the corrections a pilot can act on. Speed is reported as the aircraft's own
 * speed through the air — not a carrier-relative touchdown speed, which is a different number.
 */
export function approach(p: Any, s: Any): IApproach {
  if (!s)
    return {
      carrier: null,
      phase: "none",
      point: { x: p.x, z: p.z },
      altitude: p.y,
      ready: false,
      cues: ["NO AVAILABLE DECK"],
      range: 0,
      astern: 0,
      lateral: 0,
      headingError: 0,
      speed: p.speed ?? 0,
      descent: p.vy ?? 0,
    };
  const local = localPoint(p, s);
  const range = distance2(p, s);
  const ready = finalReady(p, s);
  const setup = setupPoint(s);
  const headingError = angleDelta(p.heading, s.heading);
  // Once the aircraft has actually reached the setup point — or is already inside the groove —
  // guidance turns up the centreline toward the deck instead of orbiting the setup fix.
  const arrived = distance2(p, setup) < 300;
  const inGroove = local.forward < 0 && range < SETUP.astern && Math.abs(local.right) < FINAL.lateral * 3;
  const phase: Phase = ready
    ? "final"
    : range >= SETUP.capture && !inGroove
      ? "transit"
      : arrived || inGroove
        ? "groove"
        : "setup";
  const cues: string[] = [];
  if (ready) cues.push("READY FOR L");
  else if (phase === "transit") cues.push("ON COURSE FOR THE SETUP POINT");
  else {
    if (!p.gear) cues.push("GEAR NOT DOWN");
    if (local.forward > 0) cues.push("GO AROUND — AHEAD OF THE DECK");
    else if (range > FINAL.range) cues.push(`CLOSE TO ${FINAL.range} M ASTERN`);
    if ((p.speed ?? 0) > FINAL.maxSpeed) cues.push("TOO FAST");
    if (p.y > FINAL.maxAltitude) cues.push("HIGH");
    else if (p.y < FINAL.minAltitude) cues.push("LOW");
    if (Math.abs(local.right) >= FINAL.lateral) cues.push(local.right > 0 ? "RIGHT OF CENTERLINE" : "LEFT OF CENTERLINE");
    if (Math.abs(headingError) >= FINAL.heading) cues.push(headingError > 0 ? "LINE UP LEFT" : "LINE UP RIGHT");
  }
  return {
    carrier: s,
    phase,
    point: phase === "final" || phase === "groove" ? { x: s.x, z: s.z } : setup,
    altitude:
      phase === "transit"
        ? SETUP.transitAltitude
        : phase === "setup"
          ? SETUP.altitude
          : clamp(glidePath(-local.forward), FINAL.minAltitude + 4, SETUP.altitude),
    ready,
    cues,
    range,
    astern: -local.forward,
    lateral: local.right,
    headingError,
    speed: p.speed ?? 0,
    descent: p.vy ?? 0,
  };
}

export interface IReserve {
  available: boolean;
  /** Seconds of flying the remaining route needs, including the manoeuvre reserve. */
  needed: number;
  /** Seconds of fuel actually left at the observed burn. */
  have: number;
  spare: number;
}

const UNAVAILABLE: IReserve = Object.freeze({ available: false, needed: 0, have: 0, spare: 0 });

/**
 * Return reserve from observed burn and the remaining route. A leak raises the burn and a diversion
 * lengthens the route, so the margin falls without touching the engine or adding fuel. Without a
 * positive finite burn and ground speed sample there is no estimate — never an infinite range.
 */
export function reserveEstimate(fuel: number, burnRate: number, route: number, groundSpeed: number): IReserve {
  if (!Number.isFinite(burnRate) || burnRate <= 0) return UNAVAILABLE;
  if (!Number.isFinite(groundSpeed) || groundSpeed <= 0) return UNAVAILABLE;
  if (!Number.isFinite(fuel) || !Number.isFinite(route) || route < 0) return UNAVAILABLE;
  const needed = route / groundSpeed + MANOEUVRE_RESERVE;
  const have = Math.max(0, fuel) / burnRate;
  return { available: true, needed, have, spare: have - needed };
}

/** Route still to fly: out to the astern setup point, then up the groove to the deck. */
export function routeLength(p: Any, s: Any): number {
  if (!s) return 0;
  const local = localPoint(p, s);
  if (local.forward < 0 && distance2(p, s) < SETUP.capture) return distance2(p, s);
  return distance2(p, setupPoint(s)) + SETUP.astern;
}

/**
 * The glide path the assisted final already flies, expressed once. Guidance descends along this
 * same line so the aircraft arrives at the L gate on the path rather than well above it, which is
 * what turned every guided approach into a bolter.
 */
export const GLIDE = 0.07;
export const GROOVE_FLARE = 65;

export function glidePath(astern: number): number {
  return DECK_HEIGHT + 2 + Math.max(0, astern - GROOVE_FLARE) * GLIDE;
}

/** Approach speed the groove is flown at: the assisted-final limit with a working margin. */
export const APPROACH_SPEED = FINAL.maxSpeed * 0.8;
/** Transit speed the return leg is flown at. Approach power outside the groove sinks the aircraft. */
export const CRUISE_SPEED = 90;
