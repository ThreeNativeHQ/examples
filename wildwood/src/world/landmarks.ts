/**
 * The five things worth walking to, and what the journal says once you have.
 *
 * Gameplay, not look: this file names the points, says where they are and what discovering one
 * means. `src/render/landmarks.ts` decides what each one is made of. Keeping the two apart is what
 * lets the valley be re-dressed without touching the objective, and the objective be rewritten
 * without touching a single mesh.
 *
 * Positions are authored, not rolled. Each was chosen against the height function and checked for
 * a walkable route from the spawn — no landmark sits behind ground steeper than the character
 * controller can climb, which is a promise a randomised placement cannot make.
 */
export interface ILandmark {
  readonly id: string;
  /** What the compass and the prompt call it. */
  readonly name: string;
  /** One line for the journal, written as the walker would note it. */
  readonly note: string;
  readonly x: number;
  readonly z: number;
  /** How close you must stand before `E` will do anything, in metres. */
  readonly reach: number;
}

export const LANDMARKS: readonly ILandmark[] = [
  {
    id: "stone",
    name: "the standing stone",
    note: "A single slab on the east knoll, leaning north. Older than the wood around it.",
    reach: 6,
    x: 34,
    z: -12,
  },
  {
    id: "log",
    name: "the fallen giant",
    note: "A trunk down across the gully, wide enough to walk. Its roots still hold a wall of earth.",
    reach: 6,
    x: -8,
    z: 34,
  },
  {
    id: "shore",
    name: "still water",
    note: "The lake's north-east shore. Reeds, silt, and no wind on the surface at all.",
    reach: 7,
    x: -28.2,
    z: 11.3,
  },
  {
    id: "camp",
    name: "the charcoal ring",
    note: "Someone camped here. Stones set in a circle, the ground inside them still black.",
    reach: 6,
    x: 18,
    z: 40,
  },
  {
    id: "cairn",
    name: "the ridge cairn",
    note: "Stacked flat stones at the top of the climb. From here the whole valley is one bowl.",
    reach: 7,
    x: 4,
    z: -58,
  },
];

/** Where the walk starts: the middle of the valley, in a clearing that can see all five ways out. */
export const TRAILHEAD = { x: 0, z: 0 } as const;

/**
 * The nearest landmark still to be found, and how far away it is.
 *
 * Returns `undefined` once every one has been inspected, which is what the HUD reads to know the
 * walk is over. Ties are impossible in practice and broken by declaration order if they happen.
 */
export function nearestUnfound(
  x: number,
  z: number,
  found: ReadonlySet<string>,
): { readonly landmark: ILandmark; readonly distance: number } | undefined {
  let best: { landmark: ILandmark; distance: number } | undefined;
  for (const landmark of LANDMARKS) {
    if (found.has(landmark.id)) continue;
    const distance = Math.hypot(x - landmark.x, z - landmark.z);
    if (best === undefined || distance < best.distance) best = { distance, landmark };
  }
  return best;
}

/** The landmark you are standing close enough to inspect, if any. */
export function withinReach(
  x: number,
  z: number,
  found: ReadonlySet<string>,
): ILandmark | undefined {
  for (const landmark of LANDMARKS) {
    if (found.has(landmark.id)) continue;
    if (Math.hypot(x - landmark.x, z - landmark.z) <= landmark.reach) return landmark;
  }
  return undefined;
}
