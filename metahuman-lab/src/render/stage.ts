import {
  BackSide,
  Box3,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  Object3D,
  type PerspectiveCamera,
  SphereGeometry,
  Vector3,
} from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { color, mix, screenUV, smoothstep, vec2 } from "three/tsl";
import { setKeyDirection } from "./look.js";

/**
 * The stage: low-key, and framed on whatever the specimen actually is.
 *
 * The rig is three directional lights and a vignette, and it is aimed at one measured target — the
 * owner's own reference render of this MetaHuman in Unreal. Read off it, in sRGB: the backdrop is a
 * dark blue-grey at 15..29, the lit cheek at 131/83/63 and the shadowed temple at 68/34/24, and the
 * hair mass is 14/13/11. So the lit side has to sit about twice the shadow side rather than level
 * with it, the fill has to be dim enough that the shadow side keeps the skin's own hue instead of
 * turning grey, and the hair has to be allowed to be almost black. Those three numbers are the
 * whole reason this is a low-key rig now; the previous one lit the face to 111/73/60 on both sides
 * of the terminator, which is the "flat" the reference is being compared against.
 */

/**
 * Backdrop: a large inverted sphere, so there is no horizon line to read as a seam.
 *
 * It is *unlit* and vignetted in screen space. A lit dome takes its brightness from the same three
 * lights as the face, so as the key came up to sculpt the face the backdrop came up with it and the
 * subject stopped separating — measured, 45/48/53 where the reference reads 15/19/20. A `colorNode`
 * that reads the frame's own coordinates costs one smoothstep, ignores the lights entirely, and
 * puts the darkest part of the wall directly behind the head, which is where a portrait vignette
 * belongs and what the reference's near-black halo around the hair is.
 */
function backdrop(): Mesh {
  const material = new MeshBasicNodeMaterial({ side: BackSide });
  const wall = mix(color(BACKDROP_TOP).rgb, color(BACKDROP_FLOOR).rgb, smoothstep(0, 1, screenUV.y));
  const radius = screenUV.sub(vec2(0.5)).length();
  material.colorNode = wall.mul(smoothstep(0.32, 0.8, radius).mul(0.4).add(0.6));
  const dome = new Mesh(new SphereGeometry(BACKDROP_RADIUS, 24, 16), material);
  dome.name = "backdrop";
  dome.frustumCulled = false;
  return dome;
}

/** The wall's own gradient: darkest at the top of the frame, lifting towards the floor. */
const BACKDROP_TOP = "#1a2427";
const BACKDROP_FLOOR = "#2b3a3e";

/**
 * How far away the backdrop is, in the same units as the camera's far plane.
 *
 * The two have to agree: a dome the far plane clips is not a backdrop, it is a black frame, and
 * the near-plane/far-plane pair is derived from how close the camera stands to a face — so the
 * backdrop is sized from the framing instead of being a fixed 6 units that a portrait crops away.
 */
const BACKDROP_RADIUS = 8;

/**
 * The key's direction, as offsets from the subject in subject-radii: front-left and a little above.
 *
 * Expressed against the subject rather than the origin so that aiming the light and aiming its
 * shadow are the same statement; see `setupStage`.
 */
const KEY_OFFSET = new Vector3(-1.0, 0.7, 2.4);

/**
 * A three-point rig sized to the subject, and low-key.
 *
 * Key from front-left and slightly above, fill from the right at a fifth of the key, and a rim from
 * behind to separate hair-line from backdrop. The fill is neutral rather than blue on purpose: a
 * blue fill over a brown face does not read as fill, it reads as a grey face, and the reference's
 * shadow side is the skin's own brown all the way down. The ambient is deliberately near-nothing:
 * the head carries a baked cavity map that only reaches the *indirect* term, so a bright ambient
 * flattens the very detail the texture set exists to show.
 */
export function setupStage(scene: Object3D, radius: number, at: Vector3): void {
  const key = new DirectionalLight(0xfff0dc, 4.2);
  key.name = "key";
  // Well round to the front rather than off to the side: a portrait lit from 45° loses half the
  // face to shadow, and this rig's whole subject is the middle of that face.
  key.position.copy(at).add(KEY_OFFSET.clone().multiplyScalar(radius));
  // **The light is aimed at the subject, not at the world origin, and the shadow needs that to
  // work at all.** A `DirectionalLight` shades the whole scene from `position - target`, so leaving
  // the target at the origin lights the face perfectly well — measured, the skin is within 3% of
  // the reference on the shadow cheek — while the *shadow camera* is a small orthographic box hung
  // on that same axis, and the face is 1.43 m from the origin in a rig whose subject radius is
  // 0.17 m. So the head fell outside the frustum and the cast shadows the key was enabled for never
  // arrived. Aiming both at `at` leaves the shading direction bit-identical and puts the box on the
  // face, which is the whole fix.
  key.target.position.copy(at);
  // **The key is the only shadow-caster in the scene**, and turning it on is the single largest
  // depth change left against the reference. Without it nothing in this rig casts: the head's own
  // geometry is the only occluder, so the nose cannot shade the philtrum, the brow cannot shade the
  // socket, and the jaw cannot shade the neck — and those are exactly the three places the brief
  // asks for "strong cavity/AO in eye sockets and under the nose". Measured at matched anatomical
  // points, the reference is 46/17/10 under the nose and 17/9/7 in the socket against this rig's
  // 93/56/44 and a lit lid. A baked cavity map cannot carry that: it is a texture, and a texture
  // cannot know where the nose is.
  //
  // The fill and the rim cast nothing on purpose, so the shadow side stays open, and `normalBias`
  // is well above zero because this face is a 60 000-triangle mesh being rewritten by 782 morph
  // targets every frame — a bias tuned for a static prop is acne on a talking one.
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -radius * 1.6;
  key.shadow.camera.right = radius * 1.6;
  key.shadow.camera.top = radius * 1.6;
  key.shadow.camera.bottom = -radius * 1.6;
  key.shadow.camera.near = 0.05;
  key.shadow.camera.far = radius * 8;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = radius * 0.03;
  const fill = new DirectionalLight(0xd8d2cc, 0.28);
  fill.name = "fill";
  fill.position.copy(at).add(new Vector3(1.9, 0.2, 1.5).multiplyScalar(radius));
  fill.target.position.copy(at);
  const rim = new DirectionalLight(0xffe9cf, 0.5);
  rim.name = "rim";
  rim.position.copy(at).add(new Vector3(0.4, 1.4, -2.2).multiplyScalar(radius));
  rim.target.position.copy(at);
  // Neutral, not blue. The backdrop is unlit and carries the reference's own cool cast
  // (15/19/20) on its own, so a blue sky term here bought nothing and cost the hair: the cards are
  // 0.004-linear albedo, and at 0.08 of a blue-grey they came out as cold steel speckles along
  // every silhouette. Measured on the round-9 capture, against a hairline the brief calls "no
  // glints".
  const ambient = new HemisphereLight(0x4a4a4a, 0x0d0f11, 0.08);
  ambient.name = "ambient";
  // The targets are scene members, not free-floating: three updates a light's shadow camera from
  // `target.matrixWorld`, and an un-parented target never gets one.
  scene.add(key, key.target, fill, fill.target, rim, rim.target, ambient, backdrop());
  // The TSL skin graph is told which light is the key, and this is that light's world
  // direction. It is read back from the object rather than recomputed from `radius` so the two can
  // never disagree: the scatter has to follow the terminator the material is actually lit by.
  setKeyDirection(KEY_DIRECTION.copy(key.position).sub(key.target.position));
}

/** Scratch for the one line above; the stage is set up once, so this needs no more than itself. */
const KEY_DIRECTION = new Vector3();

/**
 * Where the camera stands relative to the face, as angles off the head's own forward axis.
 *
 * `dolly` scales the framing distance, so a close-up is the same pose pulled in rather than a
 * second pose that drifts the moment the specimen changes.
 */
export interface Vantage {
  readonly yaw: number;
  readonly pitch: number;
  readonly dolly: number;
}

const DEG = Math.PI / 180;

/** The turn, kept as one value because both names below are the same shot. */
const TURN = { yaw: 36 * DEG, pitch: 4 * DEG, dolly: 1.02 } as const;

export const VANTAGES = {
  /** Straight on, the whole head in frame: the neutral every other capture is compared against. */
  front: { yaw: 0, pitch: 0, dolly: 1 },
  /** Turned away from the key, which is what shows whether a look survives an angle. */
  "three-quarter": TURN,
  /**
   * The same turn under the two names a reviewer asks for it by, and its mirror.
   *
   * Named for where the nose points in frame, which is the only handedness the capture itself
   * carries: at +36° the camera stands on the specimen's `+x` side and the nose reads to image
   * left. The mirror is a second turn rather than a flipped copy of the first, so the two shots differ
   * in which cheek the key falls on as well as in which side of the neck is seen edge-on.
   */
  "three-quarter-left": TURN,
  "three-quarter-right": { yaw: -36 * DEG, pitch: 4 * DEG, dolly: 1.02 },
  /**
   * Side on, which is where the neck is at its hardest: the cheekbone, the jaw's angle and the
   * shoulder's rim all have to stack into one silhouette, and any of the three ending early shows.
   */
  profile: { yaw: 90 * DEG, pitch: 2 * DEG, dolly: 1.02 },
  /**
   * The framing above, with a pose on it.
   *
   * Not pulled in: an open jaw is a question about whether the chin stays welded to the neck, and a
   * close-up crops the chin, so the shot that answers it is the one the neutral is composed in.
   */
  expression: { yaw: 0, pitch: -2 * DEG, dolly: 1 },
  /** The same pose from the turn, which is where a jaw seam shows itself first. */
  "expression-3q": TURN,
  /**
   * Up and in on the brow, because the brow is the one part of this face a second look has to
   * check: the cards are welded to the skin, and the only way to see that they are is a shot where
   * the skin underneath is visibly moving.
   */
  "brow-raise": { yaw: 0, pitch: 9 * DEG, dolly: 0.88 },
} as const satisfies Readonly<Record<string, Vantage>>;

export type VantageName = keyof typeof VANTAGES;

/**
 * The face, measured off the two eyeballs the specimen carries.
 *
 * The eye pair is the only landmark every face has, and the interpupillary distance it gives is
 * what the rest of the framing is expressed in — so a head twice this size or half of it frames
 * identically. The shot is then built from one number:
 *
 *   ABOVE_EYES_IPD  how much of the subject stands *above* the eye line, in eye-widths
 *   EYES_DOWN       where the eye line sits in the frame
 *
 * Both are measured off the owner's reference render of this same MetaHuman rather than chosen:
 * its pupils are 200 px apart in a 1280x720 frame and the eye line sits at y 263, so the frame is
 * 3.6 eye-widths tall and the eye line is 36.5% of the way down. That is a portrait, not a bust —
 * the frame is filled, and the crown of the hair is cut by the top edge, which is what the reference
 * does. It is also the single change that most helps the hair: 15 974 cards over a 2x larger head is
 * 4x the pixels per card, and a card whose strand pattern cannot survive a 2-pixel quad is the
 * sparse, sparkly, scalp-showing result the brief is a complaint about.
 */
const ABOVE_EYES_IPD = 1.55;
const EYES_DOWN = 0.365;

/**
 * The panel's share of the frame's width, and how far the subject therefore sits off centre.
 *
 * The expression panel is a fixed `22rem` down the right-hand edge, so the width a portrait may
 * actually use is what is left of it. Centring the head in the *canvas* puts a third of the face
 * under an opaque panel, and the canvas is full-bleed behind the UI — measured, the eye line
 * landed at x 714 of a frame the eye can be seen at 0..896. A lens shift rather than an orbit is
 * the fix: the camera slides along its own right axis, so the pose, the distance and the angle the
 * subject is seen at are all exactly what they were, and the head is centred in what is left.
 *
 * `22rem` of a 1280-wide capture is 0.275 of it; the number is rounded up so the face is biased a
 * hair towards the panel rather than away from it, which is the side that reads as composed.
 */
const PANEL_SHARE = 0.28;
const OFF_CENTRE = PANEL_SHARE / 2;

const BOX = new Box3();
const SIZE = new Vector3();
const POINT = new Vector3();

/**
 * The midpoint of the two eyeballs, and the distance between them, from the loaded geometry.
 *
 * Read off whichever mesh carries a material the export called a refractive eye, which is why this
 * runs *before* the look replaces those materials: afterwards the names are this sample's, not the
 * export's. The eye's own vertices are the ones its material's group indexes where a group
 * exists, and the whole position attribute where it does not — because the GLB's nine primitives
 * arrive either as one mesh with nine groups or as nine meshes, and both are the same eyeball.
 */
function measureEyes(root: Object3D): { readonly centre: Vector3; readonly ipd: number } {
  const centres: Vector3[] = [];
  const seen = new Set<string>();
  root.updateWorldMatrix(true, true);
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (mesh.isMesh !== true) return;
    const position = mesh.geometry.getAttribute("position");
    if (position === undefined) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const [index, material] of materials.entries()) {
      const name = material?.name ?? "";
      seen.add(
        `${mesh.type} x${materials.length} materials, ${mesh.geometry.groups.length} groups, ` +
          `"${name || "(unnamed)"}"`,
      );
      if (!/eyerefractive/i.test(name)) continue;
      const group = mesh.geometry.groups.find((entry) => entry.materialIndex === index);
      const from = group?.start ?? 0;
      const to = group === undefined ? position.count : group.start + group.count;
      BOX.makeEmpty();
      for (let at = from; at < to; at += 1)
        BOX.expandByPoint(POINT.fromBufferAttribute(position, at).applyMatrix4(mesh.matrixWorld));
      if (!BOX.isEmpty()) centres.push(BOX.getCenter(new Vector3()));
    }
  });
  // Naming what was walked is the difference between a fixable report and a guessing one.
  if (centres.length < 2)
    throw new Error(
      `no pair of eyeballs to frame a portrait on: found ${centres.length}, and the graph holds ` +
        `${[...seen].join(", ") || "no meshes"}`,
    );
  const first = centres[0]!;
  const second = centres[1]!;
  return { centre: new Vector3().addVectors(first, second).multiplyScalar(0.5), ipd: first.distanceTo(second) };
}

/**
 * Everything the framing is made of, measured rather than authored.
 *
 * The eye pair is the only landmark every face has, and the framing is expressed in inter-pupillary
 * distances so a head twice this size frames identically. Keeping the numbers separate from the
 * camera is what lets `FaceCamera` re-place the camera sixty times a second without re-measuring the
 * face, and lets `swayLashes` size the lash cards against the same frame the portrait was built on.
 */
export interface Framing {
  /** The midpoint of the two eyeballs: what the camera orbits and what it looks at. */
  readonly centre: Vector3;
  /** The distance between them, which is the unit everything else is in. */
  readonly ipd: number;
  /** How tall the frame is, in metres, at the framed distance. */
  readonly visible: number;
  /** The framed distance itself, before any dolly. */
  readonly distance: number;
}

/** Measure the framing off the loaded geometry. `distance` needs the camera's own field of view. */
export function measureFraming(camera: PerspectiveCamera, root: Object3D): Framing {
  const { centre, ipd } = measureEyes(root);
  // The frame height that puts `ABOVE_EYES_IPD` eye-widths above the eye line, of which `EYES_DOWN`
  // is the share of the frame that sits above it.
  const visible = (ipd * ABOVE_EYES_IPD) / EYES_DOWN;
  return {
    centre,
    ipd,
    visible,
    distance: visible / (2 * Math.tan((camera.fov * Math.PI) / 360)),
  };
}

/**
 * Stand the camera at one pose of a framing.
 *
 * `offset` is a pan in the frame's own plane, applied after the look so it slides the subject across
 * the frame without rolling the camera or changing the angle the face is seen from.
 */
export function placeCamera(
  camera: PerspectiveCamera,
  framing: Framing,
  vantage: Vantage,
  offset: Vector3 = ZERO,
): void {
  const { centre, visible } = framing;
  const distance = framing.distance * vantage.dolly;
  camera.near = Math.max(0.01, distance * 0.2);
  // The backdrop is BACKDROP_RADIUS away, so the far plane has to be past it whatever the framing.
  camera.far = Math.max(distance * 20, BACKDROP_RADIUS * 2);
  camera.position.set(
    centre.x + Math.sin(vantage.yaw) * Math.cos(vantage.pitch) * distance,
    centre.y + Math.sin(vantage.pitch) * distance,
    centre.z + Math.cos(vantage.yaw) * Math.cos(vantage.pitch) * distance,
  );
  // Looking a sixth of the frame's height *below* the eye line, which is what puts the eye line a
  // third of the way down the frame — and leaves the chin short of the bottom edge.
  camera.lookAt(
    centre.x + offset.x,
    centre.y - visible * (0.5 - EYES_DOWN) + offset.y,
    centre.z + offset.z,
  );
  // The lens shift, applied after the look so the orientation is untouched: `aspect` is already in
  // `camera.aspect`, so this is a fraction of the frame's own width and holds at any window shape.
  camera.translateX(visible * camera.aspect * OFF_CENTRE);
}

const ZERO = new Vector3();

/**
 * Put the camera on the face, and report how tall the frame is where it stands.
 *
 * The one-call spelling of `measureFraming` plus `placeCamera`, kept because the lash cards are sized
 * against the same frame this reports, so one call sizes the portrait and its detail.
 */
export function frameFace(
  camera: PerspectiveCamera,
  root: Object3D,
  vantage: Vantage = VANTAGES.front,
): number {
  const framing = measureFraming(camera, root);
  placeCamera(camera, framing, vantage);
  return framing.visible;
}

/**
 * Spread the lash cards apart, so a lash is wide enough to be a lash.
 *
 * Measured, not guessed. The lash geometry is a continuous two-vertex-wide ribbon along the lid,
 * and each pair of triangles along it is one card sampling a 26x53 texel window of a 2048 atlas.
 * At the framing `HEAD_SHARE` gives, that window lands about 1.5 screen pixels across, so the two or
 * three lashes inside it are a third of a pixel each. An alpha test then keeps whichever one happens
 * to cover a pixel centre — measured, 5% of the card's area survives — which is exactly the "a few
 * flecks at the outer corners" report, and no threshold widens a texel.
 *
 * So the cards are splayed instead: each window is opened across the lashes it holds, which widens
 * every lash in it with it and leaves the gap between them. The lash material blends its coverage
 * rather than testing it, so a card's empty air costs nothing and only the lashes it really holds
 * darken the lid.
 */
const LASH_SPREAD = 0.018;

/**
 * Move every lash card's corners apart, once, in the model's own bind space.
 *
 * The lash cards lie on the eyelid, so a card's own normal is the direction they must not move
 * along and its own tangent is the direction they must. The frame's height sets the size, so this
 * measures the look against the framing instead of hard-coding a size in metres — and the lash
 * material's colour, not its size, is what separates hair from skin.
 *
 * Consecutive cards share an edge, so a vertex is moved by the first card that claims it: moving it
 * once per card would open the ribbon by twice the distance asked for.
 */
export function swayLashes(root: Object3D, visible: number): void {
  const open = visible * LASH_SPREAD;
  const moved = new Set<number>();
  root.updateWorldMatrix(true, true);
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (mesh.isMesh !== true) return;
    const { geometry } = mesh;
    const position = geometry.getAttribute("position");
    const normal = geometry.getAttribute("normal");
    const tangent = geometry.getAttribute("tangent");
    const uv = geometry.getAttribute("uv");
    const index = geometry.getIndex();
    if (position === undefined || normal === undefined || tangent === undefined || uv === undefined) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const [at, material] of materials.entries()) {
      if (!/eyelash/i.test(material?.name ?? "")) continue;
      const group = geometry.groups.find((entry) => entry.materialIndex === at);
      // No group means the whole index buffer is this primitive, which is the nine-mesh spelling of
      // the same export; either way the range below is the cards and nothing else.
      const start = group?.start ?? 0;
      const end = group === undefined ? index?.count ?? 0 : group.start + group.count;
      for (let card = start; card + 5 < end; card += 6) {
        const quad = [0, 1, 2, 3, 4, 5].map((offset) => index!.getX(card + offset));
        if (new Set(quad).size !== 4) continue;
        let low = Infinity;
        let high = -Infinity;
        for (const vertex of quad) {
          const u = uv.getX(vertex);
          low = Math.min(low, u);
          high = Math.max(high, u);
        }
        if (high === low) continue;
        for (const vertex of quad) {
          if (moved.has(vertex)) continue;
          moved.add(vertex);
          const across = ((uv.getX(vertex) - (low + high) / 2) / (high - low)) * open;
          if (across === 0) continue;
          // The card's own tangent, projected onto its own normal, so the splay follows the lid's
          // curvature instead of a world axis the cards do not share.
          NORMAL.fromBufferAttribute(normal, vertex);
          TANGENT.fromBufferAttribute(tangent, vertex);
          TANGENT.addScaledVector(NORMAL, -TANGENT.dot(NORMAL));
          if (TANGENT.lengthSq() === 0) continue;
          TANGENT.normalize().multiplyScalar(across);
          POSITION.fromBufferAttribute(position, vertex).add(TANGENT);
          position.setXYZ(vertex, POSITION.x, POSITION.y, POSITION.z);
        }
      }
      position.needsUpdate = true;
      break;
    }
  });
}

const NORMAL = new Vector3();
const TANGENT = new Vector3();
const POSITION = new Vector3();

/** The subject's own size, which is what the lights are scaled to. */
export function subjectRadius(root: Object3D): number {
  root.updateWorldMatrix(true, true);
  BOX.setFromObject(root);
  BOX.getSize(SIZE);
  return Math.max(0.2, SIZE.length() * 0.25);
}
