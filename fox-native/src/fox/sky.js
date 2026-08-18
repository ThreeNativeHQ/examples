import * as THREE from 'three';
import { C, flat } from './palette.js';

/**
 * Gradient dome baked into vertex colours.
 *
 * The web-only version of this file used a GLSL `ShaderMaterial` with `gl_FragColor`.
 * That compiles under WebGLRenderer and produces nothing under WebGPURenderer, which is
 * what both the browser default and every native host use here. Vertex colours give the
 * same gradient on all three backends with no shader language involved.
 */
export function createSky(scene) {
  const geometry = new THREE.SphereGeometry(600, 32, 16);
  const position = geometry.attributes.position;
  const top = new THREE.Color(C.skyTop);
  const bottom = new THREE.Color(C.skyBottom);
  const colors = new Float32Array(position.count * 3);
  const normal = new THREE.Vector3();
  const color = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    normal.fromBufferAttribute(position, i).normalize();
    const h = THREE.MathUtils.clamp(normal.y * 1.15 + 0.12, 0, 1);
    color.copy(bottom).lerp(top, h ** 0.75);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const sky = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    }),
  );
  sky.frustumCulled = false;
  scene.add(sky);
  return sky;
}

export function createLights(scene) {
  const hemi = new THREE.HemisphereLight(0xbfe4ff, 0x6d8a55, 0.72);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(C.sun, 2.6);
  sun.position.set(-40, 60, 34);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0012;
  sun.shadow.normalBias = 0.035;
  const cam = sun.shadow.camera;
  cam.left = -34; cam.right = 34; cam.top = 34; cam.bottom = -34;
  cam.near = 1; cam.far = 190;
  scene.add(sun);
  scene.add(sun.target);

  // Cool bounce from the sky-side so shadowed rock does not read as flat grey.
  const rim = new THREE.DirectionalLight(0x8fc4ff, 0.5);
  rim.position.set(30, 18, -40);
  scene.add(rim);

  return { sun, hemi };
}

/** Puffy cumulus built from squashed spheres — cheap and reads correctly at distance. */
function makeCloud(scale, rng) {
  const g = new THREE.Group();
  const material = flat(C.cloud, { fog: false });
  const lobes = 5 + Math.floor(rng() * 4);
  for (let i = 0; i < lobes; i++) {
    const r = (0.6 + rng() * 0.7) * scale;
    const lobe = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), material);
    lobe.position.set(
      (i - lobes / 2) * scale * 0.75 + (rng() - 0.5) * scale * 0.4,
      (rng() - 0.4) * scale * 0.35,
      (rng() - 0.5) * scale * 0.5,
    );
    lobe.scale.y = 0.72;
    g.add(lobe);
  }
  return g;
}

export function createClouds(scene, rng) {
  const clouds = [];
  for (let i = 0; i < 26; i++) {
    const scale = 3 + rng() * 5;
    const c = makeCloud(scale, rng);
    c.position.set(
      -140 + rng() * 420,
      14 + rng() * 46,
      -60 - rng() * 240,
    );
    c.userData.speed = 0.25 + rng() * 0.5;
    c.userData.threeNativeDynamic = true;
    c.userData.threeNativeTransformMode = 'translation';
    scene.add(c);
    clouds.push(c);
  }
  // A low bank of haze clouds under the floating islands.
  for (let i = 0; i < 14; i++) {
    const c = makeCloud(5 + rng() * 6, rng);
    c.position.set(-160 + rng() * 460, -22 - rng() * 16, -30 - rng() * 160);
    c.userData.speed = 0.1 + rng() * 0.2;
    c.userData.threeNativeDynamic = true;
    c.userData.threeNativeTransformMode = 'translation';
    scene.add(c);
    clouds.push(c);
  }

  return (dt) => {
    for (const c of clouds) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > 300) c.position.x = -160;
    }
  };
}
