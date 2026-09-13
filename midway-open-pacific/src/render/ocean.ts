/** Reference Pacific swells, evaluated by the engine's analytic WaveField on a dense near grid. */
import { reflectedSky, oceanRipples, SUN_DIRECTION } from "./environment.js";
import { WaveField } from "@threenative/core";
import { BufferGeometry, Float32BufferAttribute, Mesh, Vector2, Vector4 } from "three";
import {
  Fn, cameraPosition, dot, float, mix, mx_noise_float, positionGeometry,
  reflect, smoothstep, uniform, uniformArray, varying, vec3,
} from "three/tsl";
import { MeshBasicNodeMaterial, type Node } from "three/webgpu";

const WAVES = [
  [.94, .34, 108, 1.15], [.76, .65, 61, .72], [-.61, .79, 87, .68],
  [.40, -.92, 45, .31], [.42, .91, 34, .38], [-.35, .94, 18, .19],
  [.99, -.12, 9.4, .08], [.70, .71, 4.8, .035],
];

export function createOcean() {
  const origin = uniform(new Vector2());
  const time = uniform(0);
  const sun = vec3(SUN_DIRECTION);
  const ships = Array.from({ length: 20 }, () => new Vector4(1e8, 1e8, 0, 0));
  const sizes = Array.from({ length: 20 }, () => new Vector4());
  const shipNodes = uniformArray<"vec4">(ships, "vec4");
  const sizeNodes = uniformArray<"vec4">(sizes, "vec4");
  const fields = WAVES.map(([dx, dz, wavelength, amplitude]) => {
    const length = Math.hypot(dx, dz);
    const x = dx / length, z = dz / length, k = 2 * Math.PI / wavelength;
    return new WaveField({
      waves: [{ direction: { x, z }, wavelength, amplitude, speed: Math.sqrt(9.81 * k), detail: true }],
      domainWarp: [{ waveVector: { x: -z * k * .22, z: x * k * .22 }, displacement: { x: x * .85 / k, z: z * .85 / k }, speed: .07 }],
    });
  });
  const ripples = Array.from({ length: 6 }, (_, i) => {
    const frequency = 1.35 * 1.94 ** i;
    const angle = .4 + i * Math.atan2(.785, .62);
    return new WaveField({ waves: [{ direction: { x: Math.cos(angle), z: Math.sin(angle) }, wavelength: 2 * Math.PI / frequency, amplitude: .047 * .66 ** i / frequency, speed: Math.sqrt(9.81 * frequency), detail: true }] });
  });

  // Logarithmic rings keep metre-scale triangles beside the carrier and reach the horizon.
  // Ring count sets how finely the swell is sampled at range, and the ships sit at range: at
  // 156 rings the spacing out at 300m was 21m, so a 45m wave got two vertices and the sea
  // flattened into ripples exactly where a destroyer is being looked at. Doubling the rings
  // halves that spacing and costs only vertices, not another wave evaluation per pixel.
  const segments = 288, rings = 312, positions = [0, 0, 0], indices: number[] = [];
  const growth = Math.log(1 + 100000 / 1.6) / rings;
  for (let r = 0; r < rings; r++) {
    const radius = 1.6 * (Math.exp((r + 1) * growth) - 1);
    for (let j = 0; j < segments; j++) {
      const a = j / segments * Math.PI * 2;
      positions.push(Math.cos(a) * radius, 0, Math.sin(a) * radius);
    }
  }
  for (let j = 0; j < segments; j++) indices.push(0, 1 + (j + 1) % segments, 1 + j);
  for (let r = 1; r < rings; r++) for (let j = 0; j < segments; j++) {
    const a = 1 + (r - 1) * segments + j, b = 1 + (r - 1) * segments + (j + 1) % segments;
    const c = 1 + r * segments + j, d = 1 + r * segments + (j + 1) % segments;
    indices.push(a, d, c, a, b, d);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const material = new MeshBasicNodeMaterial({ fog: false });
  const point = positionGeometry.xz.add(origin);
  const height = Fn(() => {
    const h = float(0).toVar();
    for (const field of fields) h.addAssign(field.heightNode({ point, time }));
    return h;
  })();
  material.positionNode = vec3(positionGeometry.x, height, positionGeometry.z);
  const world = varying(point);
  const worldHeight = varying(height);
  material.colorNode = Fn(() => {
    const footprint = world.dFdx().length().max(world.dFdy().length()).toVar();
    const slope = vec3(0, 0, 0).toVar();
    const variance = float(0).toVar();
    const crest = float(0).toVar();
    for (const [i, field] of [...fields, ...ripples].entries()) {
      const wave = field.waves[0];
      const k = 2 * Math.PI / wave.wavelength;
      const fade = footprint.mul(k * 1.35).pow(2).mul(-.5).exp();
      const n = field.normalNode({ point: world, time, fade }).toVar();
      slope.addAssign(vec3(n.x.div(n.y), 0, n.z.div(n.y)));
      variance.addAssign(fade.oneMinus().mul((wave.amplitude! * k) ** 2 * .5));
      if (i < fields.length) crest.addAssign(field.heightNode({ point: world, time, fade }).sub(wave.amplitude! * .6).max(0).mul(.32));
    }
    slope.addAssign(oceanRipples(world, time).mul(smoothstep(.15, 2.4, footprint).oneMinus()));
    const normal = slope.add(vec3(0, 1, 0)).normalize().toVar();
    const view = cameraPosition.sub(vec3(world.x, worldHeight, world.y)).normalize().toVar();
    const nv = dot(normal, view).max(.001);
    const fresnel = nv.oneMinus().pow(5).mul(.97963).add(.02037);
    const skyColor = reflectedSky;
    const reflection = reflect(view.negate(), normal);
    const facing = dot(normal, sun).mul(.5).add(.5).clamp(0, 1);
    const scatter = dot(view, sun.negate()).max(0).pow(3).mul(worldHeight.add(1).max(0)).mul(.14);
    const body = mix(vec3(.004, .018, .042), vec3(.012, .078, .13), facing.mul(.14).add(.10).add(scatter));
    const nh = dot(normal, view.add(sun).normalize()).max(0);
    const nl = dot(normal, sun).max(.001);
    const pixelVariance = dot(normal.dFdx(), normal.dFdx()).max(dot(normal.dFdy(), normal.dFdy()));
    const roughness = variance.mul(3).add(pixelVariance.mul(1.8)).add(.09 ** 2).sqrt().clamp(.09, .48);
    const result = mix(body, skyColor(reflection, roughness), fresnel).toVar();
    const a2 = roughness.pow(4);
    const distribution = a2.div(nh.pow(2).mul(a2.sub(1)).add(1).pow(2).mul(Math.PI).add(.0000002));
    const masking = nv.div(nv.mul(roughness.oneMinus()).add(roughness)).mul(nl.div(nl.mul(roughness.oneMinus()).add(roughness)));
    const spec = distribution.mul(masking).mul(fresnel).div(nv.mul(nl).mul(4).add(.001)).min(14).mul(nl);
    result.addAssign(vec3(1.45, 1.04, .65).mul(spec));
    const noise = mx_noise_float(world.mul(.48).add(time.mul(.04))).mul(.5).add(.5);
    const foam = smoothstep(.34, .52, crest).mul(smoothstep(.55, .77, noise)).mul(.14).mul(smoothstep(4, 22, footprint).oneMinus()).toVar();
    for (let i = 0; i < ships.length; i++) {
      const s = shipNodes.element(i), size = sizeNodes.element(i);
      const rel = world.sub(s.xy);
      const right = rel.x.mul(s.z.cos()).add(rel.y.mul(s.z.sin()));
      const along = rel.x.mul(s.z.sin()).sub(rel.y.mul(s.z.cos()));
      const aft = along.negate().sub(s.w.mul(.41));
      const fade = smoothstep(0, 20, aft).mul(smoothstep(20, 760, aft).oneMinus()).mul(size.z);
      const edge = right.abs().sub(aft.mul(.34).add(size.x.mul(.25)));
      const wake = edge.pow(2).negate().div(aft.max(0).mul(.044).add(4)).exp().mul(fade);
      const wash = right.pow(2).negate().div(size.x.pow(2).mul(.2).add(aft.max(0).mul(2)).max(1)).exp().mul(aft.max(0).div(-260).exp()).mul(fade);
      foam.addAssign(wake.mul(.42).add(wash.mul(.45)).mul(noise.mul(.62).add(.38)));
    }
    result.assign(mix(result, vec3(.52, .65, .66), foam.clamp(0, .72)));
    const distance = cameraPosition.sub(vec3(world.x, worldHeight, world.y)).length();
    return mix(result, skyColor(vec3(view.x, .015, view.z).normalize()), distance.mul(-.000012).exp().oneMinus());
  })();
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -2;
  mesh.name = "sea-surface";
  return {
    mesh,
    update(camera: { x: number; z: number }, elapsed: number, vessels: Array<{ x: number; z: number; heading: number; length: number; visualLength?: number; width: number; speed: number; sunk: boolean; kind: string; surfaced?: boolean }>) {
      time.value = elapsed;
      origin.value.set(camera.x, camera.z);
      mesh.position.set(camera.x, 0, camera.z);
      for (let i = 0; i < ships.length; i++) {
        const s = vessels[i];
        if (s && !s.sunk && (s.kind !== "sub" || s.surfaced)) {
          ships[i].set(s.x, s.z, s.heading, s.visualLength ?? s.length);
          sizes[i].set(s.width, s.speed, Math.min(1, s.speed / 8), 0);
        } else sizes[i].z = 0;
      }
    },
  };
}
