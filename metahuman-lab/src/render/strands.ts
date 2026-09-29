import {
  Box3,
  type Camera,
  Color,
  Float32BufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  type Object3D,
  type PerspectiveCamera,
  type Scene,
  type SkinnedMesh,
  Sphere,
  Vector2,
  Vector3,
  type WebGLRenderer,
} from "three";
import { MeshBasicNodeMaterial, type Node, StorageBufferAttribute } from "three/webgpu";
import {
  cameraPosition,
  cross,
  dot,
  float,
  Fn,
  instanceIndex,
  max,
  min,
  mix,
  modelWorldMatrix,
  modelWorldMatrixInverse,
  normalize,
  oneMinus,
  positionGeometry,
  positionPrevious,
  positionWorld,
  pow,
  saturate,
  select,
  sqrt,
  storage,
  uniform,
  varying,
  vec3,
  vec4,
} from "three/tsl";

/**
 * Strand hair: every fibre of a groom drawn as a camera-facing ribbon, expanded in the vertex
 * shader from two storage buffers.
 *
 * Split in two on purpose. `StrandMesh` is **mechanism** — the buffers, the ribbon expansion, the
 * one-pixel clamp with coverage carried as a per-strand keep ratio, the motion vectors TRAA needs, the
 * strand-count LOD and the per-root skin follow for brows — and takes every appearance decision as
 * an argument. `hairShading` below it is this sample's **look**: Kajiya-Kay with shifted
 * Marschner-style R and TRT lobes and a cheap self-shadow. The first half could move to the engine
 * unchanged; the second stays here.
 *
 * **The draw.** A strand of n points is n-1 segments and each segment is a quad. The geometry is one
 * instance of `CHUNK` segments (6 vertices each) and the draw is `ceil(points / CHUNK)` instances, so
 * vertex `v` of instance `i` is segment `i * CHUNK + v / 6` — no index buffer and no per-segment
 * attribute, only the two storage buffers. A segment whose first point is a strand's tip (`t == 1`)
 * collapses to a point: that is the seam between two strands, and it costs one degenerate quad per
 * strand. Strands are stored shuffled (`tools/prepare.mjs`), so drawing the first K strands is a
 * random K-subset, and the LOD is one instance count.
 *
 * **Width.** A coil fibre is 0.16 mm and a portrait pixel is about half a millimetre, so almost
 * every strand is sub-pixel. A ribbon narrower than a pixel does not rasterise continuously, so each
 * ribbon is drawn at least `minPixels` wide and keeps its true width as *coverage*: a strand is drawn
 * only where its seed is under `trueWidth / drawnWidth`, so a stable subset of whole-pixel fibres
 * carries the groom's real density, and the TRAA on the post chain anti-aliases their edges.
 * Opaque, depth-written, no sorting of 66 000 strands.
 *
 * Measured, why not a per-pixel stochastic cut-out that changes every frame: TRAA clamps history
 * to the current frame's 3x3 neighbourhood, and a fibre present in 40% of frames is, in the other
 * 60%, surrounded by background — the clamp erases it, and the first capture drew a head with only
 * a faint haze of hair. A per-strand subset is the same average density with nothing to clamp.
 */

/** Segments per instance. 8 keeps an instance at 48 vertices, well above a warp's worth. */
const CHUNK = 8;

export interface IStrands {
  readonly strandCount: number;
  readonly pointCount: number;
  /** First point of each strand, plus one past the end: `strandCount + 1` entries. */
  readonly first: Uint32Array;
  /** x, y, z, width per point, metres. */
  readonly points: Float32Array;
  /** t (0 root .. 1 tip), depth in the volume (0 buried .. 1 exposed), strand seed in [0, 1), 0. */
  readonly attrs: Float32Array;
}

const MAGIC = 0x31534e54;

/** Parse the `TNS1` layout `tools/prepare.mjs` writes. Fails closed on a short or foreign file. */
export function parseStrands(buffer: ArrayBuffer): IStrands {
  const header = new Uint32Array(buffer, 0, 3);
  if (header[0] !== MAGIC) throw new Error("not a TNS1 strand file; run `node tools/prepare.mjs --strands`");
  const strandCount = header[1] as number;
  const pointCount = header[2] as number;
  const firstAt = 12;
  const pointsAt = firstAt + (strandCount + 1) * 4;
  const attrsAt = pointsAt + pointCount * 16;
  if (buffer.byteLength !== attrsAt + pointCount * 16)
    throw new Error(`strand file is ${buffer.byteLength} bytes; its header says ${attrsAt + pointCount * 16}`);
  return {
    strandCount,
    pointCount,
    first: new Uint32Array(buffer, firstAt, strandCount + 1),
    points: new Float32Array(buffer, pointsAt, pointCount * 4),
    attrs: new Float32Array(buffer, attrsAt, pointCount * 4),
  };
}

/** The nodes a shading function gets, all in world space. */
export interface IStrandInputs {
  /** Unit strand direction, root to tip. */
  readonly tangent: Node<"vec3">;
  /** 0 at the root, 1 at the tip. */
  readonly along: Node<"float">;
  /** 0 buried in the volume, 1 on its outside. */
  readonly depth: Node<"float">;
  /** Unit direction from the groom's centre to this fragment: the volume's own normal. */
  readonly outward: Node<"vec3">;
  readonly view: Node<"vec3">;
  /** The strand's stable seed in [0, 1): the fibre's own identity, constant along its length. */
  readonly seed: Node<"float">;
}

export interface IStrandOptions {
  /** Returns the fragment's linear colour. The look; see `hairShading`. */
  readonly shade: (inputs: IStrandInputs) => Node<"vec3">;
  /** The narrowest a ribbon is drawn, in pixels. Default 1. */
  readonly minPixels?: number;
  /** Multiplies every authored width. Default 1. */
  readonly widthScale?: number;
  /** Multiplies the minimum pixel width along the strand: 1 keeps it flat, 0 follows the taper. Default 1. */
  readonly tipTaper?: number;
}

export class StrandMesh extends Mesh<InstancedBufferGeometry, MeshBasicNodeMaterial> {
  readonly strands: IStrands;
  readonly #pointsAttribute: StorageBufferAttribute;
  /** Authored positions, kept when a follow rewrites the live buffer. */
  readonly #rest: Float32Array;
  readonly #limit = uniform(0);
  readonly #widthScale = uniform(1);
  readonly #pixel = uniform(0.001);
  readonly #centre = uniform(new Vector3());
  readonly #centreLocal = new Vector3();
  readonly #baseWidth: number;
  #drawn = 0;
  #lastFrame = -1;

  constructor(strands: IStrands, options: IStrandOptions) {
    const corners: number[] = [];
    for (let sub = 0; sub < CHUNK; sub += 1)
      for (const [end, side] of [[0, -1], [0, 1], [1, -1], [0, 1], [1, 1], [1, -1]] as const)
        corners.push(sub, end, side);
    const geometry = new InstancedBufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(corners, 3));
    super(geometry, new MeshBasicNodeMaterial());
    this.strands = strands;
    this.#rest = strands.points.slice();
    this.#baseWidth = options.widthScale ?? 1;
    this.#pointsAttribute = new StorageBufferAttribute(strands.points, 4);
    const points = storage(this.#pointsAttribute, "vec4", strands.pointCount).toReadOnly();
    const attrs = storage(new StorageBufferAttribute(strands.attrs, 4), "vec4", strands.pointCount).toReadOnly();

    // --- vertex: which segment, which end, which side.
    const index = instanceIndex.toFloat().mul(CHUNK).add(positionGeometry.x);
    const last = Math.max(0, strands.pointCount - 2);
    const at = min(index, float(last)).toUint();
    const a = points.element(at);
    const b = points.element(at.add(1));
    const ta = attrs.element(at);
    const tb = attrs.element(at.add(1));
    const end = positionGeometry.y;
    const side = positionGeometry.z;
    const camera = modelWorldMatrixInverse.mul(vec4(cameraPosition, 1)).xyz;
    const minPixels = options.minPixels ?? 1;
    const tipTaper = options.tipTaper ?? 1;
    // Coverage, decided once per segment at its first point so all six corners agree: the share of
    // the drawn (pixel-clamped) width the fibre really covers. A strand is kept where its seed is
    // under that share — a stable, per-strand subset, so the mass keeps its true density while
    // every drawn fibre is a whole pixel wide.
    const segmentWidth = a.w.mul(this.#widthScale);
    const coverage = saturate(
      segmentWidth.div(max(segmentWidth, camera.sub(a.xyz).length().mul(this.#pixel).mul(minPixels))),
    );
    // A tip's segment, or one past the drawn range, is the seam to the next strand: collapsed.
    const alive = ta.x
      .lessThan(0.9999)
      .and(index.add(1).lessThan(this.#limit))
      .and(ta.z.lessThan(coverage));
    const centre = mix(a.xyz, b.xyz, end);
    const tangent = b.xyz.sub(a.xyz).normalize();
    const toCamera = camera.sub(centre);
    const pixel = toCamera.length().mul(this.#pixel);
    const width = mix(a.w, b.w, end).mul(this.#widthScale);
    // A flat one-pixel floor is right for a groom, whose fibres are all one gauge from root to tip.
    // It is wrong for a brow, whose authored widths taper to nothing: the floor holds every tip at a
    // whole pixel, so a fibre that has narrowed to a fraction of its root still draws as a hard dot,
    // and a mass of those reads as spikes standing past the arch. `tipTaper` walks the floor down
    // along the strand's own `along` parameter, so the tip can vanish with the fibre that made it.
    // At 0 the floor is flat and this is the groom's behaviour exactly.
    const alongHere = mix(ta.x, tb.x, end);
    const floor = pixel
      .mul(minPixels)
      .mul(mix(float(1), oneMinus(pow(alongHere, float(2))), float(tipTaper)));
    const drawn = max(width, floor);
    const across = normalize(cross(tangent, toCamera));
    const expanded = centre.add(across.mul(side.mul(drawn).mul(0.5)));
    const material = this.material;
    // Motion vectors: three's velocity node reprojects `positionPrevious`, the raw geometry
    // attribute, which here is a corner code rather than a position — the ribbons would report
    // garbage motion and TRAA would throw their history away every frame. Writing the expanded
    // position into that varying makes the engine's own velocity (previous model matrix, unjittered
    // projection) true for strands too.
    material.positionNode = Fn(() => {
      const position = select(alive, expanded, a.xyz).toVar();
      positionPrevious.assign(position);
      return position;
    })();

    const tangentWorld = varying(modelWorldMatrix.mul(vec4(tangent, 0)).xyz);
    const along = varying(mix(ta.x, tb.x, end));
    const depth = varying(mix(ta.y, tb.y, end));

    // --- fragment.
    material.colorNode = options.shade({
      tangent: normalize(tangentWorld),
      along,
      depth,
      outward: normalize(positionWorld.sub(this.#centre)),
      view: normalize(cameraPosition.sub(positionWorld)),
      seed: varying(mix(ta.z, tb.z, end)),
    });
    material.name = "metahuman-lab/strands";

    const box = new Box3();
    const point = new Vector3();
    for (let p = 0; p < strands.pointCount; p += 1)
      box.expandByPoint(point.fromArray(strands.points, p * 4));
    geometry.boundingBox = box.clone().expandByScalar(0.005);
    geometry.boundingSphere = box.getBoundingSphere(new Sphere()).set(
      geometry.boundingBox.getCenter(new Vector3()),
      geometry.boundingBox.getSize(new Vector3()).length() / 2,
    );
    for (let s = 0; s < strands.strandCount; s += 1)
      this.#centreLocal.add(point.fromArray(strands.points, (strands.first[s] as number) * 4));
    this.#centreLocal.divideScalar(Math.max(1, strands.strandCount));
    this.castShadow = false;
    this.receiveShadow = false;
    this.setStrandCount(strands.strandCount);
  }

  /** How many strands are drawn now. */
  get strandCount(): number {
    return this.#drawn;
  }

  /**
   * Draw the first `count` (shuffled, so random) strands, each widened by `total / count` so the
   * groom keeps its coverage — the mass reads the same at a quarter of the strands, only coarser.
   */
  setStrandCount(count: number): void {
    const drawn = Math.max(1, Math.min(this.strands.strandCount, Math.round(count)));
    this.#drawn = drawn;
    const points = this.strands.first[drawn] as number;
    this.#limit.value = points;
    this.#widthScale.value = this.#baseWidth * (this.strands.strandCount / drawn);
    this.geometry.instanceCount = Math.ceil(points / CHUNK);
  }

  /** The drawn size of a pixel and the volume's centre, once per frame. */
  override onBeforeRender(renderer: WebGLRenderer, _scene: Scene, camera: Camera): void {
    const three = renderer as unknown as {
      info: { frame: number };
      getRenderTarget(): { height: number } | null;
      getDrawingBufferSize(target: Vector2): Vector2;
    };
    const frame = three.info.frame;
    if (frame === this.#lastFrame) return;
    this.#lastFrame = frame;
    const perspective = camera as PerspectiveCamera;
    const height = three.getRenderTarget()?.height ?? three.getDrawingBufferSize(SIZE).y;
    this.#pixel.value = (2 * Math.tan((perspective.fov * Math.PI) / 360)) / Math.max(1, height);
    this.#centre.value.copy(this.#centreLocal).applyMatrix4(this.matrixWorld);
  }

  /**
   * Move each strand rigidly by an offset of its root (metres, this mesh's space), from the rest
   * positions. The brows' follow; a whole groom never calls it.
   */
  offsetStrands(offsets: Float32Array): void {
    const { first, strandCount } = this.strands;
    const live = this.strands.points;
    for (let s = 0; s < strandCount; s += 1) {
      const dx = offsets[s * 3] as number;
      const dy = offsets[s * 3 + 1] as number;
      const dz = offsets[s * 3 + 2] as number;
      for (let p = first[s] as number; p < (first[s + 1] as number); p += 1) {
        live[p * 4] = (this.#rest[p * 4] as number) + dx;
        live[p * 4 + 1] = (this.#rest[p * 4 + 1] as number) + dy;
        live[p * 4 + 2] = (this.#rest[p * 4 + 2] as number) + dz;
      }
    }
    this.#pointsAttribute.needsUpdate = true;
  }
}

const SIZE = new Vector2();

/* ------------------------------------------------------------ brows that follow the brow ------- */

/** What `tools/prepare.mjs` writes beside the brow strands. */
export interface IBrowSkin {
  readonly nearest: readonly number[];
  readonly rest: readonly (readonly number[])[];
  readonly channels: readonly { readonly target: string; readonly deltas: readonly number[] }[];
}

/**
 * Per-frame root displacement for the brows: the transferred brow deltas at each root, weighted by
 * the face's own morph influences, then skinned with the nearest head vertex's weights — the same
 * transfer the brow cards were welded with, evaluated per root on the CPU (1 354 roots).
 *
 * The strands must be a child of `head` at identity, so the root space *is* the head's bind space.
 * Throws when the sidecar's vertex indices do not land on the rest positions it recorded: that is a
 * sidecar prepared against a different head, and a brow that silently rides the wrong vertex.
 */
export function browFollow(head: SkinnedMesh, strands: StrandMesh, skin: IBrowSkin): () => void {
  const dictionary = head.morphTargetDictionary ?? {};
  const influences = head.morphTargetInfluences ?? [];
  const position = head.geometry.getAttribute("position");
  const count = strands.strands.strandCount;
  if (skin.nearest.length !== count) throw new Error("brows.skin.json does not match brows.strands.bin");
  skin.nearest.forEach((vertex, s) => {
    const rest = skin.rest[s] as readonly number[];
    const off = Math.hypot(
      position.getX(vertex) - (rest[0] as number),
      position.getY(vertex) - (rest[1] as number),
      position.getZ(vertex) - (rest[2] as number),
    );
    if (off > 1e-5) throw new Error(`brow root ${s} indexes head vertex ${vertex}, which is not where it was prepared`);
  });
  const channels = skin.channels.map((channel) => {
    const slot = dictionary[channel.target];
    if (slot === undefined) throw new Error(`the head carries no morph target '${channel.target}'`);
    return { slot, deltas: channel.deltas };
  });
  const roots = new Float32Array(count * 3);
  for (let s = 0; s < count; s += 1) {
    const p = (strands.strands.first[s] as number) * 4;
    roots[s * 3] = strands.strands.points[p] as number;
    roots[s * 3 + 1] = strands.strands.points[p + 1] as number;
    roots[s * 3 + 2] = strands.strands.points[p + 2] as number;
  }
  const offsets = new Float32Array(count * 3);
  const moved = new Vector3();
  return () => {
    for (let s = 0; s < count; s += 1) {
      moved.fromArray(roots, s * 3);
      for (const channel of channels) {
        const weight = influences[channel.slot] ?? 0;
        if (weight === 0) continue;
        moved.x += (channel.deltas[s * 3] as number) * weight;
        moved.y += (channel.deltas[s * 3 + 1] as number) * weight;
        moved.z += (channel.deltas[s * 3 + 2] as number) * weight;
      }
      head.applyBoneTransform(skin.nearest[s] as number, moved);
      offsets[s * 3] = moved.x - (roots[s * 3] as number);
      offsets[s * 3 + 1] = moved.y - (roots[s * 3 + 1] as number);
      offsets[s * 3 + 2] = moved.z - (roots[s * 3 + 2] as number);
    }
    strands.offsetStrands(offsets);
  };
}

/* -------------------------------------------------------------------- this sample's hair look -- */

/** One light as the hair graph sees it: world direction towards the light, and colour x intensity. */
export interface IStrandLight {
  readonly direction: Vector3;
  readonly colour: Color;
}

/** Every directional light in the scene, read once (the stage is static). */
export function stageLights(scene: Object3D): { lights: IStrandLight[]; ambient: Color } {
  const lights: IStrandLight[] = [];
  const ambient = new Color(0, 0, 0);
  scene.traverse((object) => {
    const light = object as Object3D & {
      isDirectionalLight?: boolean;
      isHemisphereLight?: boolean;
      color: Color;
      intensity: number;
      target?: Object3D;
    };
    if (light.isDirectionalLight === true && light.target !== undefined)
      lights.push({
        direction: light.position.clone().sub(light.target.position).normalize(),
        colour: light.color.clone().multiplyScalar(light.intensity),
      });
    if (light.isHemisphereLight === true) ambient.add(light.color.clone().multiplyScalar(light.intensity));
  });
  return { lights, ambient };
}

export interface IHairLook {
  /** Linear albedo of the fibre. */
  readonly albedo: Color;
  /** The TRT lobe's tint: the warm sheen light picks up through a dark fibre. */
  readonly sheen: Color;
  /** Brightness left at the root, and at the bottom of the volume. */
  readonly rootShade: number;
  readonly depthShade: number;
  /** Primary (R) and secondary (TRT) lobe weights and exponents. */
  readonly primary: readonly [weight: number, exponent: number];
  readonly secondary: readonly [weight: number, exponent: number];
  /** How far each lobe's tangent is tilted along the volume normal (the cuticle's shift). */
  readonly shift: number;
  /** Multiplies the ambient. */
  readonly ambient: number;
  /**
   * How much each fibre's own seed varies its brightness, 0 for a uniform mass.
   *
   * A brow is a few dozen fibres lying in one plane on the skin, so every one of them has the same
   * normal, the same `depth` and the same key — the terms that separate a groom's fibres from each
   * other are all *volume* terms, and a brow has no volume. Drawn that way it is one flat slab with
   * a silhouette, which is what a coverage-boosted brow collapses into. The seed is per fibre and
   * stable along its length, so varying brightness by it reintroduces exactly the per-fibre
   * separation a volume would have given, for free and without a second draw. 0 keeps the old look.
   */
  readonly seedVary?: number;
}

/**
 * Kajiya-Kay diffuse and two Marschner-placed specular lobes, with the self-shadow a groom this
 * dense needs to read as a mass: darker toward the root, darker the deeper a point sits in the
 * volume, and each light's contribution fading on the side of the volume that faces away from it.
 */
export function hairShading(lights: readonly IStrandLight[], ambient: Color, look: IHairLook) {
  return ({ tangent, along, depth, outward, view, seed }: IStrandInputs) => {
    const albedo = vec3(look.albedo.r, look.albedo.g, look.albedo.b);
    const sheen = vec3(look.sheen.r, look.sheen.g, look.sheen.b);
    const occlusion = mix(float(look.rootShade), float(1), pow(along, float(0.6))).mul(
      mix(float(look.depthShade), float(1), depth.mul(depth)),
    );
    const primaryT = normalize(tangent.add(outward.mul(look.shift)));
    const secondaryT = normalize(tangent.sub(outward.mul(look.shift * 1.5)));
    let colour = albedo.mul(vec3(ambient.r, ambient.g, ambient.b)).mul(look.ambient);
    for (const light of lights) {
      const L = vec3(light.direction.x, light.direction.y, light.direction.z);
      const C = vec3(light.colour.r, light.colour.g, light.colour.b);
      const sinTL = sqrt(saturate(float(1).sub(dot(tangent, L).pow(2))));
      const facing = saturate(dot(outward, L).mul(0.6).add(0.4));
      const H = normalize(L.add(view));
      const r = pow(sqrt(saturate(float(1).sub(dot(primaryT, H).pow(2)))), float(look.primary[1])).mul(
        look.primary[0],
      );
      const trt = pow(sqrt(saturate(float(1).sub(dot(secondaryT, H).pow(2)))), float(look.secondary[1])).mul(
        look.secondary[0],
      );
      colour = colour.add(
        C.mul(albedo.mul(sinTL).add(vec3(r, r, r)).add(sheen.mul(trt))).mul(facing),
      );
    }
    // Per-fibre brightness, from the fibre's own seed. See `seedVary`.
    const seedVary = look.seedVary ?? 0;
    const vary = mix(float(1 - seedVary), float(1 + seedVary), seed);
    return colour.mul(occlusion).mul(vary);
  };
}
