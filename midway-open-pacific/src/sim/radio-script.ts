/**
 * The friendly radio/PA script, and nothing else. Pure data plus a resolver, so the simulation can
 * name a line without importing the queue or any browser timer. `src/speech.ts` plays it.
 *
 * The table is deterministic — the exact words the offline generator produced — so a caption can
 * never drift from the voice. `{direction}` and `{ship}` resolve to whole generated variants.
 */

export type SpeechPriority = 1 | 2 | 3;
export type SpeechChannel = "radio" | "intercom" | "pa";

export interface ISpeechRow {
  readonly text: string;
  readonly voice: "control" | "wingman" | "gunner" | "pa";
  readonly priority: SpeechPriority;
  readonly variants?: "direction" | "ship";
}

/** The PRD's exact scripts. Keys are the R/P ids; `variants` marks the substituted rows. */
export const SPEECH: Record<string, ISpeechRow> = {
  R01: { text: "Scout Three to Enterprise. Unidentified aircraft in sight. Investigating.", voice: "wingman", priority: 2 },
  R02: { text: "Scout Three to Enterprise. Enemy aircraft sighted to the {direction} of our task force.", voice: "wingman", priority: 2, variants: "direction" },
  R03: { text: "Scout Three to Enterprise. Zeros in sight. Fighters, watch your altitude.", voice: "wingman", priority: 2 },
  R04: { text: "Scout Three to Enterprise. Large ships sighted. Possible carriers. Sending position.", voice: "wingman", priority: 2 },
  R05: { text: "Enterprise to the strike group. Enemy ships are reported moving {direction}. Check your attack course.", voice: "control", priority: 2, variants: "direction" },
  R06: { text: "Enterprise to all fighters. Zeros are strafing our flight deck. Intercept immediately.", voice: "control", priority: 1 },
  R07: { text: "Enterprise to all fighters. Enemy dive bombers are coming in on us. Break up their attack.", voice: "control", priority: 1 },
  R08: { text: "Enterprise to all fighters. Torpedo planes low over the water. Intercept before they release.", voice: "control", priority: 1 },
  R09: { text: "Scout Three. We have the enemy fighters in sight. Moving to intercept.", voice: "wingman", priority: 2 },
  R10: { text: "Enterprise to all aircraft. The immediate attack has broken off. Maintain your patrol.", voice: "control", priority: 3 },
  R11: { text: "Enterprise to all aircraft. Our flight deck is damaged. Stand by for recovery instructions.", voice: "control", priority: 2 },
  R12: { text: "Enterprise to all aircraft. {ship} reports fire aboard. Keep clear of the ship.", voice: "control", priority: 2, variants: "ship" },
  R13: { text: "Engine's running rough. Watch your power.", voice: "gunner", priority: 1 },
  R14: { text: "Fuel is running low. We need to head home.", voice: "gunner", priority: 1 },
  R15: { text: "Scout Three to Enterprise. {ship} is going down.", voice: "wingman", priority: 2, variants: "ship" },
  R16: { text: "Scout Three. Target in sight. Following you in.", voice: "wingman", priority: 2 },
  R17: { text: "Bomb away.", voice: "gunner", priority: 3 },
  R18: { text: "Scout Three to Enterprise. Hits on the carrier. She's burning.", voice: "wingman", priority: 2 },
  R19: { text: "Fighter behind us! Break!", voice: "gunner", priority: 1 },
  R20: { text: "Scout Three to Enterprise. Contact lost. Last position reported.", voice: "wingman", priority: 3 },
  R21: { text: "Enterprise to returning aircraft. Deck is clear. Join the landing pattern.", voice: "control", priority: 3 },
  R22: { text: "Wave off! Deck is not clear. Go around.", voice: "control", priority: 1 },
  R23: { text: "Enterprise to Yorktown aircraft. Recover aboard Enterprise. Join the landing pattern.", voice: "control", priority: 2 },
  R24: { text: "Scout Three. Forming up on your wing.", voice: "wingman", priority: 3 },
  R25: { text: "Scout Three to Enterprise. Pilot in the water. Marking the position.", voice: "wingman", priority: 2 },
  R26: { text: "Scout Three. You're hit — smoke coming from your engine. How does she handle?", voice: "wingman", priority: 2 },
  R27: { text: "Scout Three. You're streaming fuel. Get her on a course for home while she still flies.", voice: "wingman", priority: 2 },
  R28: { text: "Scout Three. You're burning! Get out of her!", voice: "wingman", priority: 1 },
  R29: { text: "Scout Three to Enterprise. Lead is hit hard and losing power. I'm staying with him.", voice: "wingman", priority: 1 },
  R30: { text: "Scout Three to Enterprise. Lead is going down. Marking the position.", voice: "wingman", priority: 1 },
  R31: { text: "Scout Three. You're trailing oil from the engine. Watch your temperature.", voice: "wingman", priority: 2 },
  P01: { text: "General quarters. General quarters. All hands to battle stations.", voice: "pa", priority: 2 },
  P02: { text: "Flight quarters. Stand by to launch aircraft. Keep the flight deck clear.", voice: "pa", priority: 3 },
  P03: { text: "Enemy aircraft approaching. All exposed personnel take cover.", voice: "pa", priority: 1 },
  P04: { text: "Fire on the flight deck. Repair parties to your stations.", voice: "pa", priority: 1 },
  P05: { text: "Torpedoes approaching. Stand by for emergency maneuver.", voice: "pa", priority: 1 },
};

export const SPEECH_DIRECTIONS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];
export const SPEECH_SHIPS = ["Enterprise", "Hornet", "Yorktown", "Akagi", "Kaga", "Soryu", "Hiryu"];

/** Caption speaker per role, for the HUD radio log. */
export const SPEAKERS: Record<ISpeechRow["voice"], string> = {
  control: "ENTERPRISE",
  wingman: "SCOUT THREE",
  gunner: "REAR GUNNER",
  pa: "DECK ANNOUNCER",
};

export interface ISpeechRequest {
  readonly id: string;
  readonly direction?: string;
  readonly ship?: string;
  /** Shipboard PA only sounds while aboard or alongside. */
  readonly channel?: SpeechChannel;
  /** Stable identity beyond the cue, e.g. the target ship, so a repeat is a real update. */
  readonly identity?: string;
  /** Rechecked before the line starts; a stale predicate drops a queued alert. */
  readonly valid?: () => boolean;
}

export interface IResolvedSpeech {
  readonly id: string;
  readonly slug: string;
  readonly text: string;
  readonly voice: string;
  readonly speaker: string;
  readonly priority: SpeechPriority;
  readonly channel: SpeechChannel;
}

/** Build the file slug and substituted text for a request; null when the cue is unknown. */
export function resolveSpeech(request: ISpeechRequest): IResolvedSpeech | null {
  const row = SPEECH[request.id];
  if (!row) return null;
  const value = row.variants === "direction" ? request.direction : row.variants === "ship" ? request.ship : undefined;
  const suffix = value ? `-${String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : "";
  return {
    id: request.id,
    slug: `${request.id.toLowerCase()}${suffix}`,
    text: value ? row.text.replace(`{${row.variants}}`, value) : row.text,
    voice: row.voice,
    speaker: SPEAKERS[row.voice],
    priority: row.priority,
    channel: request.channel ?? (row.voice === "pa" ? "pa" : row.voice === "gunner" ? "intercom" : "radio"),
  };
}

/** Normalize a simulation ship name to a confirmed radio name, so `{ship}` matches a voice clip. */
export function radioShipName(name: string): string {
  const clean = String(name).replace(/^USS\s+/i, "").trim();
  const match = SPEECH_SHIPS.find((s) => s.toLowerCase() === clean.toLowerCase());
  return match ?? clean;
}

/** Every concrete clip slug the table can request, so the loader can package them all. */
export function speechSlugList(): string[] {
  const slugs: string[] = [];
  for (const [id, row] of Object.entries(SPEECH)) {
    if (!row.variants) {
      slugs.push(id.toLowerCase());
      continue;
    }
    const values = row.variants === "direction" ? SPEECH_DIRECTIONS : SPEECH_SHIPS;
    for (const value of values) slugs.push(`${id.toLowerCase()}-${value.toLowerCase()}`);
  }
  return slugs;
}