/**
 * Deck height under a world point, or `-Infinity` over open water.
 *
 * Every whitewater parcel asks this, thousands of times an update, and the old query recomputed
 * each ship's sine, cosine and half-dimensions — and allocated an `{x, z}` through `localPoint` —
 * on every one of those calls. `cache` rebuilds the eligible ships and their constants once per
 * update, into storage it reuses, so a hull that turns, moves, surfaces or sinks is still answered
 * correctly and nothing survives an update. The test in `scripts/check-fluid.mjs` is why this is
 * exported: the oracle it checks against is the original per-call formula.
 *
 * The arithmetic is `localPoint`'s, inlined: right = dx·cos + dz·sin, forward = dx·sin − dz·cos.
 */
export function createHullQuery() {
  type Hull = { x: number; z: number; cos: number; sin: number; half: number; beam: number; reach: number; deck: number };
  const hulls: Hull[] = [];
  let count = 0;
  return {
    cache(vessels: any[]) {
      count = 0;
      for (const s of vessels) {
        if (s.sunk || (s.kind === "sub" && !s.surfaced)) continue;
        const h = hulls[count] ?? (hulls[count] = { x: 0, z: 0, cos: 0, sin: 0, half: 0, beam: 0, reach: 0, deck: 12 });
        h.x = s.x; h.z = s.z; h.cos = Math.cos(s.heading); h.sin = Math.sin(s.heading);
        h.half = s.hullLength * .5; h.beam = s.hullBeam * .5; h.reach = s.hullLength; h.deck = s.deckHeight ?? 12;
        count++;
      }
    },
    heightAt(x: number, z: number): number {
      for (let i = 0; i < count; i++) {
        const h = hulls[i]!;
        const dx = x - h.x, dz = z - h.z;
        if (Math.abs(dx) > h.reach || Math.abs(dz) > h.reach) continue;
        const forward = dx * h.sin - dz * h.cos;
        if (Math.abs(forward) >= h.half) continue;
        const taper = Math.sqrt(Math.max(0, 1 - (forward / (h.half)) ** 4));
        const right = dx * h.cos + dz * h.sin;
        if (Math.abs(right) < h.beam * taper) return h.deck;
      }
      return -Infinity;
    },
  };
}
