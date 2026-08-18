import * as THREE from 'three';

/** Colours sampled from the reference frame. */
export const C = {
  skyTop: 0x2e88e0,
  skyBottom: 0xbfe4fb,
  fog: 0xa8d6f5,
  sun: 0xfff4d6,

  grass: 0x5cbb37,
  grassDark: 0x3f8f28,
  grassLight: 0x8ede4f,
  dirt: 0x8a6a45,

  rock: 0xa8927a,
  rockDark: 0x776352,
  rockLight: 0xc6b294,
  moss: 0x6a9b3f,

  wood: 0xd0904c,
  woodDark: 0x9c6330,
  woodPost: 0xb87a3c,
  rope: 0xdcc08a,

  fur: 0xf2952f,
  furDark: 0xd4761b,
  cream: 0xfbe7c9,
  jacket: 0x2f7fd6,
  jacketDark: 0x2263ab,
  pack: 0x5c7ea3,
  ink: 0x2b1a10,

  gold: 0xffd23f,
  goldDark: 0xd79a17,
  gem: 0x3fa9f5,
  gemLight: 0x9fe0ff,

  capRed: 0xdf4a3d,
  capDark: 0xa82f26,
  shellRed: 0x9e3527,
  snailBody: 0xa8c47a,
  spot: 0xfff3e2,

  water: 0x9fe3fb,
  cloud: 0xffffff,
  brick: 0xb08d72,
  brickDark: 0x8a6c55,
  roof: 0x3f7fbf,
  metal: 0x9aa7b4,
};

const cache = new Map();

/** Cached toon-ish material; the flat 3-band ramp is what gives the stylised look. */
export function mat(color, opts = {}) {
  const key = `${color}|${JSON.stringify(opts)}`;
  if (cache.has(key)) return cache.get(key);

  const gradient = new THREE.DataTexture(
    new Uint8Array([100, 100, 100, 255, 190, 190, 190, 255, 255, 255, 255, 255]),
    3, 1, THREE.RGBAFormat,
  );
  gradient.needsUpdate = true;
  gradient.minFilter = gradient.magFilter = THREE.NearestFilter;

  const m = new THREE.MeshToonMaterial({
    color,
    gradientMap: gradient,
    ...opts,
  });
  cache.set(key, m);
  return m;
}

/**
 * Bake a per-quad brightness variation into a geometry as vertex colours.
 * Turns a flat box into mottled stone without any textures.
 */
export function mottle(geo, variance = 0.18, rng = Math.random) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const count = g.attributes.position.count;
  const colors = new Float32Array(count * 3);
  // two triangles (6 vertices) share a tint so quads read as flat stone facets
  for (let i = 0; i < count; i += 6) {
    const k = 1 - variance / 2 + rng() * variance;
    for (let v = 0; v < 6 && i + v < count; v++) {
      colors[(i + v) * 3] = k;
      colors[(i + v) * 3 + 1] = k;
      colors[(i + v) * 3 + 2] = k;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/** Box subdivided into rough facets, ready for `mottle`. */
export function rockBox(w, h, d, rng = Math.random, variance = 0.2) {
  const seg = (n) => Math.max(1, Math.min(6, Math.round(n / 3)));
  return mottle(new THREE.BoxGeometry(w, h, d, seg(w), seg(h), seg(d)), variance, rng);
}

/** Unlit material for things that should stay bright regardless of lighting (clouds, sky props). */
export function flat(color, opts = {}) {
  const key = `flat|${color}|${JSON.stringify(opts)}`;
  if (cache.has(key)) return cache.get(key);
  const m = new THREE.MeshBasicMaterial({ color, ...opts });
  cache.set(key, m);
  return m;
}
