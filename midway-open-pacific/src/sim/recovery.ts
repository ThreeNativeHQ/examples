/**
 * Getting the aircraft home. Pure geometry over the carrier's own moving frame: the H action, the
 * autopilot's navigation point, the L gate and the HUD's approach cues all read this one module,
 * so the guidance the player is shown and the eligibility the game enforces cannot drift apart.
 */
import { angleDelta, bearing, clamp, distance2, forward, localPoint } from "./math.js";

type Any = any;

/**
 * The assisted-final envelope. These are the limits `assistRecovery` has always used, expressed
 * against the deck being landed on rather than against sea level: heights are clearances above that
 * carrier's own datum, and the line-up corridor is its own deck width plus the LSO's tolerance.
 * Enterprise's deck sits at 20.06 m and Yorktown's at 20.45 m, so a fleet-wide constant promised a
 * final on one ship that was 0.39 m out of the envelope on the other.
 */
export const FINAL = Object.freeze({
  range: 700,
  minClearance: 3.94,
  maxClearance: 159.94,
  maxSpeed: 72,
  lateralMargin: 90,
  heading: 0.4,
});

/** This carrier's flight deck above the sea. Set by `Battle.setupFleet`, never by a renderer. */
export function deckDatum(s: Any): number {
  const y = s?.deckHeight;
  if (!Number.isFinite(y)) throw new Error(`carrier has no deck datum: ${s?.name ?? s}`);
  return y;
}

/** Half-width of the line-up corridor for this deck. */
export function lineUpLimit(s: Any): number {
  return (s?.deckWidth ?? 0) / 2 + FINAL.lateralMargin;
}

/** Metres the line-up centreline sits to starboard of the ship's origin; 0 when the deck is clear. */
export function deckOffset(s: Any): number {
  return s?.deckOffset ?? 0;
}

/** Where the approach is flown from: on the centreline, astern of the moving deck. */
export const SETUP = Object.freeze({
  astern: 1600,
  /** Inside the L envelope over any of the fleet's decks, so the groove starts where L can take it. */
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
  /**
   * The signed corrections the HUD repeats while the approach is engaged: bearing to the next point,
   * height above/below the target altitude and speed above/below the approach speed. Words, not raw
   * numbers, so the line can be flown without interpreting a readout.
   */
  corrections: string[];
  range: number;
  astern: number;
  lateral: number;
  headingError: number;
  speed: number;
  descent: number;
}

/** A point on the deck's extended centreline, `along` metres from the ship, in its moving frame. */
export function centrelinePoint(s: Any, along: number): { x: number; z: number } {
  const f = forward(s.heading);
  const right = deckOffset(s);
  return {
    x: s.x + f.x * along + Math.cos(s.heading) * right,
    z: s.z + f.z * along + Math.sin(s.heading) * right,
  };
}

/** The astern setup point in the carrier's frame, so it moves with the ship. */
export function setupPoint(s: Any): { x: number; z: number } {
  return centrelinePoint(s, -SETUP.astern);
}

/** How far ahead of the aircraft the groove is chased. A fixed point gets passed; a lead does not. */
export const GROOVE_LEAD = 400;

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
  const deck = deckDatum(s);
  return (
    distance2(p, s) < FINAL.range &&
    local.forward < 0 &&
    p.y > deck + FINAL.minClearance &&
    p.y < deck + FINAL.maxClearance &&
    p.speed < FINAL.maxSpeed &&
    Math.abs(local.right - deckOffset(s)) < lineUpLimit(s) &&
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
      corrections: [],
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
  const deck = deckDatum(s);
  const lateral = lineUpLimit(s);
  // Corrections are measured from the corridor's own centreline, which is `deckOffset` to starboard
  // of the ship's origin, so the cues name the side an aircraft actually has to move toward.
  const offset = deckOffset(s);
  const right = local.right - offset;
  const inGroove = local.forward < 0 && range < SETUP.astern && Math.abs(right) < lateral * 3;
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
    if (p.y > deck + FINAL.maxClearance) cues.push("HIGH");
    else if (p.y < deck + FINAL.minClearance) cues.push("LOW");
    if (Math.abs(right) >= lateral) cues.push(right > 0 ? "RIGHT OF CENTERLINE" : "LEFT OF CENTERLINE");
    if (Math.abs(headingError) >= FINAL.heading) cues.push(headingError > 0 ? "LINE UP LEFT" : "LINE UP RIGHT");
  }
  // Chase a lead point down the centreline rather than the deck itself: aiming at the ship turns
  // the approach into a pursuit curve that arrives off centreline and then oscillates.
  const point =
    phase === "final" || phase === "groove" ? centrelinePoint(s, local.forward + GROOVE_LEAD) : setup;
  const altitude =
    phase === "transit"
      ? SETUP.transitAltitude
      : phase === "setup"
        ? SETUP.altitude
        : clamp(glidePath(-local.forward, deck), deck + FINAL.minClearance + 4, SETUP.altitude);
  return {
    carrier: s,
    phase,
    point,
    altitude,
    ready,
    cues,
    corrections: correctionCues(angleDelta(bearing(p, point), p.heading), p.y - altitude, (p.speed ?? 0) - APPROACH_SPEED),
    range,
    astern: -local.forward,
    lateral: right,
    headingError,
    speed: p.speed ?? 0,
    descent: p.vy ?? 0,
  };
}

/**
 * Translate the three signed errors into what a pilot does about them. The bearing error is positive
 * to the right, the height error positive when high, and the speed error positive when fast — so each
 * line names the correction to make, not the number to read. Within tolerance the line says so.
 */
export function correctionCues(turn: number, height: number, speed: number): string[] {
  const deg = Math.round((turn * 180) / Math.PI);
  const metres = Math.round(height);
  const knots = Math.round(speed * 1.94384);
  return [
    Math.abs(deg) < 4 ? "ON CENTRELINE" : `TURN ${deg > 0 ? "RIGHT" : "LEFT"} ${Math.abs(deg)}`,
    Math.abs(metres) < 5 ? "ON GLIDE PATH" : `${metres > 0 ? "HIGH" : "LOW"} ${Math.abs(metres)} M`,
    Math.abs(knots) < 3 ? "ON SPEED" : `${knots > 0 ? "FAST" : "SLOW"} ${Math.abs(knots)} KT`,
  ];
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

export function glidePath(astern: number, deckHeight: number): number {
  return deckHeight + 2 + Math.max(0, astern - GROOVE_FLARE) * GLIDE;
}

/** Approach speed the groove is flown at: the assisted-final limit with a working margin. */
export const APPROACH_SPEED = FINAL.maxSpeed * 0.8;
/** Transit speed the return leg is flown at. Approach power outside the groove sinks the aircraft. */
export const CRUISE_SPEED = 90;
