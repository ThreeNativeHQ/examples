// probe-entry.ts
import { Box3, Raycaster, Vector3 as Vector32 } from "three";

// src/render/cathedral.ts
import {
  BoxGeometry,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Path,
  PlaneGeometry,
  RepeatWrapping,
  RingGeometry,
  Shape,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// src/render/lighting.ts
import { DirectionalLight, PCFShadowMap } from "three";

// src/render/palette.ts
var palette = {
  skyHigh: 329226,
  skyLow: 131845,
  floor: 3814960,
  floorBand: 2367772,
  stone: 8222056,
  stoneDark: 3354666,
  player: 10475775,
  crate: 16758891,
  accent: 16767392,
  glassWarm: 16767392,
  glassCool: 11060479,
  glassRose: 14176362,
  // Near-white with the faintest warm bias. The reference's shafts are cool against warm
  // stone — a warm sun on warm stone gives one hue for the whole frame, which is exactly
  // what the first passes looked like.
  sun: 16773856
};

// src/render/lighting.ts
var NAVE = {
  /** Interior width between the two arcade faces. Every other number derives from this. */
  width: 16,
  /** Floor to vault crown. The reference reads at roughly 2.1 x the nave width. */
  height: 34,
  /** West door to east wall. */
  depth: 63,
  /** One bay. Pier, arch, triforium panel and clerestory light all repeat on this pitch. */
  bayPitch: 7,
  /** Top of the arcade storey. */
  arcadeHeight: 14,
  /** Top of the blind middle storey. */
  triforiumTop: 19,
  /** Top of the clerestory band, and the springing of the vault. */
  clerestoryTop: 28,
  /** How far the dark aisle runs behind each colonnade. */
  aisleWidth: 6,
  pierRadius: 1.15
};

// src/render/cathedral.ts
var TONE = {
  /** The bulk of the building. */
  stone: palette.stone,
  /** Capitals, string courses, ribs, tracery — anything meant to catch a rim of light. */
  bright: 9866107,
  /**
   * The upper storeys. Above the arcade the nave wall is backlit from every camera on the
   * axis, so nothing up there is separated by *light*; the storeys have to be separated by
   * their own albedo or twenty metres of wall reads as one undifferentiated slab.
   */
  upper: 10984328,
  /** Bases, plinths, wall backing. Reads as the shadow the arcade sits in. */
  base: 4867645,
  /** Triforium backing and aisle roof: the darkness the openings are read against. */
  void: palette.stoneDark
};
var materials = {
  /**
   * Everything carved. `vertexColors` multiplies the merged tints above, so one material
   * covers plinth to boss; the white base colour is deliberate, since anything else would
   * tint the stone twice.
   */
  carved: new MeshStandardMaterial({
    color: 16777215,
    metalness: 0,
    roughness: 0.92,
    vertexColors: true
  }),
  /**
   * The aisle walls: seen from one side only, so `DoubleSide` costs nothing.
   *
   * A shade above `stoneDark`, because the arcade openings are seen at sixty degrees off
   * their own plane from anywhere on the axis — at the darker value the aisle behind them
   * was pure black and the colonnade read as a wall with decorations on it.
   */
  shadowStone: new MeshStandardMaterial({
    color: 4801591,
    metalness: 0,
    roughness: 0.95,
    side: DoubleSide
  }),
  /**
   * The apse. Pale, where the aisles are dark: the east end is what the whole nave points
   * at, and an apse cut from the same value as the aisle walls closes the axis on nothing.
   */
  apseStone: new MeshStandardMaterial({
    color: palette.stone,
    metalness: 0,
    roughness: 0.9,
    side: DoubleSide
  }),
  /** The one low-roughness surface. Without it screen-space reflections have nothing to return. */
  marble: new MeshStandardMaterial({ color: palette.floor, roughness: 0.16, metalness: 0.1 }),
  marbleBand: new MeshStandardMaterial({ color: palette.floorBand, roughness: 0.2, metalness: 0.1 }),
  /** Near-black. The chancel screen reads as silhouette and nothing else. */
  iron: new MeshStandardMaterial({ color: 1315343, roughness: 0.55, metalness: 0.7 })
};
function glass(colour) {
  return new MeshBasicMaterial({ color: colour, toneMapped: false, side: DoubleSide });
}
var SQRT3 = Math.sqrt(3);
var scratch = new Matrix4();
var ARCADE_SPRING = 8;
var CLERESTORY = {
  /** Half-width of each light at the *outer* face — the hole the shadow map sees. */
  aperture: 0.72,
  /** Sill height. Clear of the triforium string course, and low enough for a 4:1 light. */
  base: 20.2,
  /** Centre of each light across the bay. Two, far enough apart to leave a real mullion. */
  lights: [-1.5, 1.5],
  /** Order depths from the nave face outward. 2.1 m of reveal in three steps. */
  reveal: [0.9, 0.6, 0.6],
  /**
   * How much wider each order gets toward the nave.
   *
   * Each light is splayed on its own rather than grouped under one containing arch. A
   * containing arch pinches fast near its own apex — at this band height it forced the
   * lights down to a 2:1 stump — and per-light splay also gives every aperture its own
   * taper, which is what makes a shaft start narrow at the glass and widen into the nave.
   */
  splay: 0.16,
  springY: 4.5,
  /** Height of the transom above the sill. */
  transomY: 2.5
};
var CLERESTORY_LIGHT_HEIGHT = CLERESTORY.springY + CLERESTORY.aperture * Math.sqrt(3);
var CLERESTORY_DEPTH = CLERESTORY.reveal.reduce((total, step) => total + step, 0);
function part(geometry, tone) {
  const flat = geometry.index === null ? geometry : geometry.toNonIndexed();
  if (flat !== geometry) geometry.dispose();
  const colour = new Color(tone);
  const count = flat.getAttribute("position").count;
  const data = new Float32Array(count * 3);
  for (let vertex = 0; vertex < count; vertex += 1) {
    data[vertex * 3] = colour.r;
    data[vertex * 3 + 1] = colour.g;
    data[vertex * 3 + 2] = colour.b;
  }
  flat.setAttribute("color", new Float32BufferAttribute(data, 3));
  return flat;
}
function weld(parts, label) {
  const merged = mergeGeometries(parts, false);
  if (merged === null) throw new Error(`cathedral: attribute mismatch welding ${label}`);
  for (const piece of parts) piece.dispose();
  return merged;
}
function pointedRise(t) {
  const along = Math.min(1, Math.abs(t));
  return Math.sqrt(Math.max(0, 4 - (1 + along) ** 2)) / SQRT3;
}
function pointedArchHole(a, springY, cx = 0) {
  const hole = new Path();
  hole.moveTo(cx - a, 0);
  hole.lineTo(cx - a, springY);
  hole.absarc(cx + a, springY, 2 * a, Math.PI, Math.PI * 2 / 3, true);
  hole.absarc(cx - a, springY, 2 * a, Math.PI / 3, 0, true);
  hole.lineTo(cx + a, 0);
  hole.closePath();
  return hole;
}
function piercedPanel(width, height, thickness, openings) {
  const panel = new Shape();
  panel.moveTo(-width / 2, 0);
  panel.lineTo(width / 2, 0);
  panel.lineTo(width / 2, height);
  panel.lineTo(-width / 2, height);
  panel.closePath();
  for (const opening of openings) {
    panel.holes.push(pointedArchHole(opening.halfWidth, opening.springY, opening.centre ?? 0));
  }
  return new ExtrudeGeometry(panel, { bevelEnabled: false, depth: thickness });
}
function aisleBay(bayPitch, wallHeight) {
  const parts = [
    part(
      piercedPanel(bayPitch, wallHeight, 0.5, [
        { halfWidth: bayPitch * 0.32, springY: wallHeight * 0.38 }
      ]),
      // A mid value, not `void`. Against a black aisle the arcade openings had nothing to be
      // darker or lighter *than*, and the whole colonnade flattened into one slab.
      4735283
    )
  ];
  for (const edge of [-1, 1]) {
    parts.push(
      part(
        new CylinderGeometry(0.38, 0.38, wallHeight, 8).translate(
          edge * bayPitch / 2,
          wallHeight / 2,
          -0.34
        ),
        TONE.base
      )
    );
    parts.push(
      part(
        new BoxGeometry(1.1, 0.3, 1.1).translate(
          edge * bayPitch / 2,
          wallHeight * 0.38,
          -0.34
        ),
        TONE.base
      )
    );
  }
  return weld(parts, "aisle bay");
}
function ribTube(points, radius) {
  return new TubeGeometry(new CatmullRomCurve3([...points]), points.length * 2, radius, 6, false);
}
function compoundPier(radius, capitalY, vaultShaftTop) {
  const parts = [];
  const socleTop = 1.5;
  const bellHeight = 1.25;
  const coreTop = capitalY - bellHeight;
  parts.push(part(new BoxGeometry(radius * 2.9, 0.5, radius * 2.9).translate(0, 0.25, 0), TONE.base));
  parts.push(part(new BoxGeometry(radius * 2.5, 0.45, radius * 2.5).translate(0, 0.72, 0), TONE.base));
  parts.push(
    part(new CylinderGeometry(radius * 1.34, radius * 1.5, 0.55, 8).translate(0, 1.22, 0), TONE.base)
  );
  parts.push(
    part(
      new CylinderGeometry(radius, radius, coreTop - socleTop, 8).translate(
        0,
        (coreTop + socleTop) / 2,
        0
      ),
      TONE.stone
    )
  );
  const shafts = 12;
  const shaftRadius = radius * 0.26;
  const shaftOrbit = radius + shaftRadius * 0.8;
  for (let index = 0; index < shafts; index += 1) {
    const angle = index / shafts * Math.PI * 2;
    const shaftX = Math.cos(angle) * shaftOrbit;
    const shaftZ = Math.sin(angle) * shaftOrbit;
    parts.push(
      part(
        new CylinderGeometry(shaftRadius, shaftRadius, coreTop - 1.35, 10).translate(
          shaftX,
          (coreTop + 1.35) / 2,
          shaftZ
        ),
        TONE.stone
      )
    );
    parts.push(
      part(
        new TorusGeometry(shaftRadius * 1.16, shaftRadius * 0.34, 6, 10).rotateX(Math.PI / 2).translate(shaftX, coreTop - 0.24, shaftZ),
        TONE.bright
      )
    );
    parts.push(
      part(
        new TorusGeometry(shaftRadius * 1.3, shaftRadius * 0.4, 6, 10).rotateX(Math.PI / 2).translate(shaftX, socleTop + 0.1, shaftZ),
        TONE.base
      )
    );
  }
  const bell = [
    new Vector2(radius * 1.16, 0),
    new Vector2(radius * 1.26, 0.09),
    new Vector2(radius * 1.14, 0.2),
    new Vector2(radius * 1.18, 0.3),
    new Vector2(radius * 1.26, 0.6),
    new Vector2(radius * 1.32, 0.86),
    new Vector2(radius * 1.36, 0.96),
    new Vector2(0, 0.96)
  ];
  parts.push(part(new LatheGeometry(bell, 16).translate(0, coreTop, 0), TONE.bright));
  parts.push(
    part(
      new BoxGeometry(radius * 2.86, 0.24, radius * 2.86).translate(0, coreTop + 1.08, 0),
      TONE.bright
    )
  );
  parts.push(
    part(
      new BoxGeometry(radius * 2.6, 0.16, radius * 2.6).translate(0, coreTop + 0.92, 0),
      TONE.bright
    )
  );
  for (let leaf = 0; leaf < 12; leaf += 1) {
    const angle = leaf / 12 * Math.PI * 2 + Math.PI / 12;
    parts.push(
      part(
        new SphereGeometry(radius * 0.13, 6, 4).scale(1.5, 0.7, 1.5).translate(
          Math.cos(angle) * radius * 1.14,
          coreTop + 0.62,
          Math.sin(angle) * radius * 1.14
        ),
        TONE.bright
      )
    );
  }
  const shaftFace = radius * 1.43 + 0.5;
  for (const [offsetZ, tallRadius, tone, top] of [
    [0, 0.5, TONE.upper, vaultShaftTop],
    [-1, 0.34, TONE.bright, NAVE.triforiumTop],
    [1, 0.34, TONE.bright, NAVE.triforiumTop],
    [-1.75, 0.24, TONE.upper, NAVE.arcadeHeight],
    [1.75, 0.24, TONE.upper, NAVE.arcadeHeight]
  ]) {
    const inset = tallRadius < 0.3 ? 0.28 : 0;
    parts.push(
      part(
        new CylinderGeometry(tallRadius, tallRadius, top, 10).translate(
          shaftFace - inset,
          top / 2,
          offsetZ
        ),
        tone
      )
    );
    if (top === vaultShaftTop) continue;
    parts.push(
      part(
        new BoxGeometry(tallRadius * 3.4, 0.34, tallRadius * 3.4).translate(
          shaftFace - inset,
          top - 0.17,
          offsetZ
        ),
        TONE.bright
      )
    );
  }
  for (const [corbelWidth, corbelDepth, corbelY] of [
    [1.3, 1.5, vaultShaftTop - 0.72],
    [1.7, 1.9, vaultShaftTop - 0.24]
  ]) {
    parts.push(
      part(
        new BoxGeometry(corbelWidth, 0.48, corbelDepth).translate(
          shaftFace - 0.14,
          corbelY,
          0
        ),
        TONE.bright
      )
    );
  }
  return weld(parts, "pier");
}
function bayWall() {
  const { arcadeHeight, bayPitch, clerestoryTop, triforiumTop } = NAVE;
  const parts = [];
  const orders = [
    { depth: 0.34, halfWidth: bayPitch * 0.4, tone: TONE.bright, z: -0.34 },
    { depth: 0.46, halfWidth: bayPitch * 0.38, tone: TONE.stone, z: 0 },
    { depth: 0.34, halfWidth: bayPitch * 0.345, tone: TONE.bright, z: 0.46 },
    { depth: 0.42, halfWidth: bayPitch * 0.315, tone: TONE.stone, z: 0.8 }
  ];
  for (const order2 of orders) {
    parts.push(
      part(
        piercedPanel(bayPitch, arcadeHeight, order2.depth, [
          { halfWidth: order2.halfWidth, springY: ARCADE_SPRING }
        ]).translate(0, 0, order2.z),
        order2.tone
      )
    );
  }
  for (const [courseY, courseTone] of [
    [arcadeHeight, TONE.upper],
    [triforiumTop, TONE.upper]
  ]) {
    parts.push(
      part(
        new BoxGeometry(bayPitch, 0.42, 0.8).translate(0, courseY + 0.21, 0.05),
        courseTone
      )
    );
    parts.push(
      part(
        new BoxGeometry(bayPitch, 0.22, 0.5).translate(0, courseY + 0.53, 0.1),
        TONE.stone
      )
    );
  }
  const triforiumHeight = triforiumTop - arcadeHeight;
  const lights = 4;
  const lightSpan = bayPitch * 0.86;
  const lightPitch = lightSpan / lights;
  const triforiumOpenings = [];
  for (let light = 0; light < lights; light += 1) {
    triforiumOpenings.push({
      centre: -lightSpan / 2 + lightPitch * (light + 0.5),
      halfWidth: lightPitch * 0.38,
      springY: triforiumHeight * 0.42
    });
  }
  parts.push(
    part(
      piercedPanel(bayPitch, triforiumHeight, 0.55, triforiumOpenings).translate(
        0,
        arcadeHeight + 0.63,
        0
      ),
      TONE.upper
    )
  );
  for (let mullion = 0; mullion <= lights; mullion += 1) {
    parts.push(
      part(
        new CylinderGeometry(0.2, 0.2, triforiumHeight * 0.5, 8).translate(
          -lightSpan / 2 + lightPitch * mullion,
          arcadeHeight + 0.63 + triforiumHeight * 0.25,
          -0.3
        ),
        TONE.upper
      )
    );
  }
  parts.push(
    part(
      new BoxGeometry(bayPitch, triforiumHeight, 0.3).translate(
        0,
        arcadeHeight + triforiumHeight / 2,
        1.25
      ),
      TONE.void
    )
  );
  parts.push(
    part(
      new BoxGeometry(bayPitch, 0.3, 1.3).translate(0, arcadeHeight + 0.78, -0.45),
      TONE.upper
    )
  );
  const clerestoryHeight = clerestoryTop - CLERESTORY.base;
  let revealZ = 0;
  CLERESTORY.reveal.forEach((depth, order2) => {
    const halfWidth = CLERESTORY.aperture + CLERESTORY.splay * (CLERESTORY.reveal.length - 1 - order2);
    parts.push(
      part(
        piercedPanel(
          bayPitch,
          clerestoryHeight,
          depth,
          CLERESTORY.lights.map((centre) => ({
            centre,
            halfWidth,
            springY: CLERESTORY.springY
          }))
        ).translate(0, CLERESTORY.base, revealZ),
        TONE.upper
      )
    );
    revealZ += depth;
  });
  parts.push(
    part(
      new BoxGeometry(
        (Math.abs(CLERESTORY.lights[1] ?? 1.5) + CLERESTORY.aperture) * 2 + 0.4,
        0.32,
        CLERESTORY_DEPTH - CLERESTORY.reveal[0]
      ).translate(0, CLERESTORY.base + CLERESTORY.transomY, CLERESTORY.reveal[0] ?? 0.9),
      TONE.bright
    )
  );
  const jambHalf = CLERESTORY.aperture + CLERESTORY.splay * (CLERESTORY.reveal.length - 1);
  for (const centre of CLERESTORY.lights) {
    for (const jamb of [-1, 1]) {
      parts.push(
        part(
          new CylinderGeometry(0.14, 0.14, CLERESTORY.springY + 0.4, 8).translate(
            centre + jamb * jambHalf,
            CLERESTORY.base + 0.3 + (CLERESTORY.springY + 0.4) / 2,
            0.34
          ),
          TONE.bright
        )
      );
    }
  }
  return weld(parts, "bay wall");
}
function vaultWeb(halfWidth, halfPitch, spring, rise) {
  const columns = 24;
  const rows = 16;
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let row = 0; row <= rows; row += 1) {
    const v = row / rows * 2 - 1;
    for (let column = 0; column <= columns; column += 1) {
      const u = column / columns * 2 - 1;
      positions.push(
        u * halfWidth,
        spring + rise * Math.max(pointedRise(u), pointedRise(v)),
        v * halfPitch
      );
      uvs.push(column / columns, row / rows);
    }
  }
  const stride = columns + 1;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const a = row * stride + column;
      const b = a + 1;
      const c = a + stride;
      indices.push(a, b, c, b, c + 1, c);
    }
  }
  const web = new BufferGeometry();
  web.setAttribute("position", new Float32BufferAttribute(positions, 3));
  web.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  web.setIndex(indices);
  web.computeVertexNormals();
  return web;
}
function ribFoot(point, along, inset, drop) {
  const pull = Math.max(0, (Math.abs(along) - 0.72) / 0.28);
  if (pull === 0) return point;
  point.x -= Math.sign(point.x) * inset * pull;
  point.y -= drop * pull;
  return point;
}
function createCathedral(floorTexture) {
  const { width, height, depth, bayPitch, arcadeHeight, pierRadius } = NAVE;
  const { triforiumTop, clerestoryTop, aisleWidth } = NAVE;
  const aisleDepth = 4.6;
  const nave2 = new Group();
  nave2.name = "cathedral";
  const bays = Math.floor(depth / bayPitch);
  const halfDepth = bays * bayPitch / 2;
  const halfWidth = width / 2;
  const chancelZ = -halfDepth + bayPitch * 2;
  const floorWidth = width + aisleWidth * 2;
  const floorDepth = bays * bayPitch;
  if (floorTexture !== void 0) {
    floorTexture.wrapS = RepeatWrapping;
    floorTexture.wrapT = RepeatWrapping;
    floorTexture.repeat.set(floorWidth / 4.5, floorDepth / 4.5);
    floorTexture.colorSpace = SRGBColorSpace;
    floorTexture.anisotropy = 8;
    materials.marble.map = floorTexture;
    materials.marble.color.setHex(16777215);
    materials.marble.needsUpdate = true;
  }
  const floor = new Mesh(new PlaneGeometry(floorWidth, floorDepth), materials.marble);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  nave2.add(floor);
  const wall = new InstancedMesh(bayWall(), materials.carved, bays * 2);
  wall.castShadow = true;
  wall.receiveShadow = true;
  let wallInstance = 0;
  for (const side of [-1, 1]) {
    for (let bay = 0; bay < bays; bay += 1) {
      const z = -halfDepth + bay * bayPitch + bayPitch / 2;
      scratch.makeRotationY(side * Math.PI / 2).setPosition(side * halfWidth, 0, z);
      wall.setMatrixAt(wallInstance, scratch);
      wallInstance += 1;
    }
  }
  wall.instanceMatrix.needsUpdate = true;
  nave2.add(wall);
  const paneGeometry = new PlaneGeometry(CLERESTORY.aperture * 2, CLERESTORY_LIGHT_HEIGHT);
  const paneY = CLERESTORY.base + CLERESTORY_LIGHT_HEIGHT * 0.5;
  const paneX = halfWidth + CLERESTORY_DEPTH - 0.02;
  for (const [tint, parity] of [
    [palette.glassWarm, 0],
    [palette.glassCool, 1]
  ]) {
    const count = Math.ceil(bays / 2) * 2 * CLERESTORY.lights.length;
    const panes = new InstancedMesh(paneGeometry, glass(tint), count);
    let paneInstance = 0;
    for (const side of [-1, 1]) {
      for (let bay = 0; bay < bays; bay += 1) {
        if (bay % 2 !== parity) continue;
        const z = -halfDepth + bay * bayPitch + bayPitch / 2;
        for (const light of CLERESTORY.lights) {
          scratch.makeRotationY(side * Math.PI / 2).setPosition(side * paneX, paneY, z + light);
          panes.setMatrixAt(paneInstance, scratch);
          paneInstance += 1;
        }
      }
    }
    panes.count = paneInstance;
    panes.instanceMatrix.needsUpdate = true;
    nave2.add(panes);
  }
  const aisleGlass = new InstancedMesh(
    new PlaneGeometry(bayPitch * 0.64, 9.2),
    glass(14197422),
    bays * 2
  );
  let aisleInstance = 0;
  for (const side of [-1, 1]) {
    for (let bay = 0; bay < bays; bay += 1) {
      const z = -halfDepth + bay * bayPitch + bayPitch / 2;
      scratch.makeRotationY(side * Math.PI / 2).setPosition(side * (halfWidth + aisleDepth + 0.54), 5, z);
      aisleGlass.setMatrixAt(aisleInstance, scratch);
      aisleInstance += 1;
    }
  }
  aisleGlass.instanceMatrix.needsUpdate = true;
  nave2.add(aisleGlass);
  const pierR = pierRadius * 1.05;
  const vaultShaftTop = clerestoryTop - 0.7;
  const pierGeometry = compoundPier(pierR, ARCADE_SPRING, vaultShaftTop);
  const piers2 = new InstancedMesh(pierGeometry, materials.carved, (bays + 1) * 2);
  piers2.castShadow = true;
  piers2.receiveShadow = true;
  let pierInstance = 0;
  for (const side of [-1, 1]) {
    for (let bay = 0; bay <= bays; bay += 1) {
      scratch.makeRotationY(side > 0 ? Math.PI : 0).setPosition(side * (halfWidth + 0.3), 0, -halfDepth + bay * bayPitch);
      piers2.setMatrixAt(pierInstance, scratch);
      pierInstance += 1;
    }
  }
  piers2.instanceMatrix.needsUpdate = true;
  nave2.add(piers2);
  const aisleWalls = new InstancedMesh(
    aisleBay(bayPitch, arcadeHeight),
    materials.carved,
    bays * 2
  );
  aisleWalls.receiveShadow = true;
  let aisleWallInstance = 0;
  for (const side of [-1, 1]) {
    for (let bay = 0; bay < bays; bay += 1) {
      const z = -halfDepth + bay * bayPitch + bayPitch / 2;
      scratch.makeRotationY(side * Math.PI / 2).setPosition(side * (halfWidth + aisleDepth), 0, z);
      aisleWalls.setMatrixAt(aisleWallInstance, scratch);
      aisleWallInstance += 1;
    }
  }
  aisleWalls.instanceMatrix.needsUpdate = true;
  nave2.add(aisleWalls);
  for (const side of [-1, 1]) {
    const aisleVault = new Mesh(
      new PlaneGeometry(bays * bayPitch, aisleDepth),
      materials.shadowStone
    );
    aisleVault.rotation.set(Math.PI / 2, 0, Math.PI / 2);
    aisleVault.position.set(side * (halfWidth + aisleDepth / 2), arcadeHeight - 0.4, 0);
    nave2.add(aisleVault);
  }
  const rise = height - clerestoryTop;
  const halfPitch = bayPitch / 2;
  const webs = new InstancedMesh(
    // A shade below the walls. The web takes bounce off the whole nave and nothing direct,
    // so at the wall's own tint it blew out to paper-white and flattened the ribs off it.
    part(vaultWeb(halfWidth, halfPitch, clerestoryTop, rise), 6050889),
    materials.carved,
    bays
  );
  webs.castShadow = false;
  webs.receiveShadow = true;
  const shaftInset = halfWidth - (pierR * 1.52 + 0.44 + 0.3);
  const ribParts = [];
  const samples = 13;
  for (const lean of [1, -1]) {
    const points = [];
    for (let sample = 0; sample < samples; sample += 1) {
      const along = sample / (samples - 1) * 2 - 1;
      points.push(
        ribFoot(
          new Vector3(
            along * halfWidth,
            clerestoryTop + rise * pointedRise(along),
            along * lean * halfPitch
          ),
          along,
          shaftInset,
          0.7
        )
      );
    }
    ribParts.push(part(ribTube(points, 0.36), TONE.bright));
  }
  for (const side of [-1, 1]) {
    const points = [];
    for (let sample = 0; sample < samples; sample += 1) {
      const along = sample / (samples - 1) * 2 - 1;
      points.push(
        new Vector3(
          side * (halfWidth - 0.32),
          clerestoryTop + rise * pointedRise(along),
          along * halfPitch
        )
      );
    }
    ribParts.push(part(ribTube(points, 0.24), TONE.bright));
  }
  const bayRibs = new InstancedMesh(weld(ribParts, "bay ribs"), materials.carved, bays);
  bayRibs.castShadow = false;
  const transversePoints = [];
  for (let sample = 0; sample < samples; sample += 1) {
    const along = sample / (samples - 1) * 2 - 1;
    transversePoints.push(
      ribFoot(
        new Vector3(along * halfWidth, clerestoryTop + rise * pointedRise(along), 0),
        along,
        shaftInset,
        0.7
      )
    );
  }
  const transverse = new InstancedMesh(
    part(ribTube(transversePoints, 0.38), TONE.bright),
    materials.carved,
    bays + 1
  );
  transverse.castShadow = false;
  const bosses = new InstancedMesh(
    part(
      new SphereGeometry(0.62, 10, 8).scale(1, 0.7, 1).translate(0, height - 0.3, 0),
      TONE.bright
    ),
    materials.carved,
    bays
  );
  bosses.castShadow = false;
  for (let bay = 0; bay < bays; bay += 1) {
    const z = -halfDepth + bay * bayPitch + bayPitch / 2;
    scratch.makeRotationY(0).setPosition(0, 0, z);
    webs.setMatrixAt(bay, scratch);
    bayRibs.setMatrixAt(bay, scratch);
    bosses.setMatrixAt(bay, scratch);
  }
  for (let joint = 0; joint <= bays; joint += 1) {
    scratch.makeRotationY(0).setPosition(0, 0, -halfDepth + joint * bayPitch);
    transverse.setMatrixAt(joint, scratch);
  }
  webs.instanceMatrix.needsUpdate = true;
  bayRibs.instanceMatrix.needsUpdate = true;
  transverse.instanceMatrix.needsUpdate = true;
  bosses.instanceMatrix.needsUpdate = true;
  nave2.add(webs, bayRibs, transverse, bosses);
  const chancelParts = [];
  const chancelOrders = [
    { depth: 0.7, halfWidth: 5.6, tone: TONE.stone, z: 0 },
    { depth: 0.55, halfWidth: 6.1, tone: TONE.bright, z: 0.7 },
    { depth: 0.75, halfWidth: 6.6, tone: TONE.bright, z: 1.25 }
  ];
  for (const order2 of chancelOrders) {
    chancelParts.push(
      part(
        piercedPanel(width, 26, order2.depth, [{ halfWidth: order2.halfWidth, springY: 12 }]).translate(
          0,
          0,
          order2.z
        ),
        order2.tone
      )
    );
  }
  const chancelArch = new Mesh(weld(chancelParts, "chancel arch"), materials.carved);
  chancelArch.position.set(0, 0, chancelZ - 2);
  chancelArch.castShadow = true;
  chancelArch.receiveShadow = true;
  nave2.add(chancelArch);
  const apseBack = new Mesh(new PlaneGeometry(13.6, height), materials.apseStone);
  apseBack.position.set(0, height / 2, -halfDepth);
  apseBack.receiveShadow = true;
  nave2.add(apseBack);
  for (const side of [-1, 1]) {
    const from = new Vector3(side * halfWidth, 0, chancelZ);
    const to = new Vector3(side * 6.8, 0, -halfDepth);
    const span = from.distanceTo(to);
    const cant = new Mesh(new PlaneGeometry(span, height), materials.apseStone);
    cant.position.set((from.x + to.x) / 2, height / 2, (from.z + to.z) / 2);
    cant.rotation.y = Math.atan2(to.x - from.x, to.z - from.z) + Math.PI / 2;
    cant.receiveShadow = true;
    nave2.add(cant);
  }
  const roseRadius = 5;
  const roseY = 17.5;
  const roseZ = -halfDepth + 0.12;
  const rose = new Mesh(new RingGeometry(0, roseRadius, 48), glass(palette.glassRose));
  rose.position.set(0, roseY, roseZ);
  nave2.add(rose);
  const traceryParts = [];
  const spokeBetween = (from, to, angle, width2) => part(
    new BoxGeometry(width2, (to - from) * roseRadius, 0.26).translate(0, (from + to) / 2 * roseRadius, 0).rotateZ(angle),
    TONE.bright
  );
  const cusp = (radiusRatio, sizeRatio, angle, tube) => part(
    new TorusGeometry(roseRadius * sizeRatio, tube, 6, 14).translate(
      Math.cos(angle) * roseRadius * radiusRatio,
      Math.sin(angle) * roseRadius * radiusRatio,
      0
    ),
    TONE.bright
  );
  for (const ratio of [0.15, 0.36, 0.62, 0.88]) {
    traceryParts.push(
      part(new RingGeometry(roseRadius * ratio - 0.1, roseRadius * ratio + 0.1, 44), TONE.bright)
    );
  }
  for (let spoke = 0; spoke < 8; spoke += 1) {
    const angle = spoke / 8 * Math.PI * 2;
    traceryParts.push(spokeBetween(0.15, 0.36, angle, 0.17));
  }
  for (let spoke = 0; spoke < 16; spoke += 1) {
    const angle = spoke / 16 * Math.PI * 2 + Math.PI / 16;
    traceryParts.push(spokeBetween(0.62, 0.88, angle, 0.15));
  }
  for (let petal = 0; petal < 8; petal += 1) {
    const angle = petal / 8 * Math.PI * 2 + Math.PI / 8;
    traceryParts.push(cusp(0.49, 0.115, angle, 0.085));
  }
  for (let petal = 0; petal < 16; petal += 1) {
    const angle = petal / 16 * Math.PI * 2;
    traceryParts.push(cusp(0.75, 0.085, angle, 0.07));
  }
  traceryParts.push(part(new RingGeometry(roseRadius, roseRadius + 1.1, 48), TONE.bright));
  const tracery = new Mesh(weld(traceryParts, "rose tracery"), materials.carved);
  tracery.position.set(0, roseY, roseZ + 0.22);
  nave2.add(tracery);
  const surroundParts = [];
  const gableFoot = new Vector2(6.5, 21.3);
  const gableApex = 27;
  const gableRun = Math.hypot(gableFoot.x, gableApex - gableFoot.y);
  for (const slope of [-1, 1]) {
    surroundParts.push(
      part(
        new BoxGeometry(gableRun + 0.4, 0.55, 0.45).rotateZ(slope * -Math.atan2(gableApex - gableFoot.y, gableFoot.x)).translate(slope * gableFoot.x / 2, (gableFoot.y + gableApex) / 2, 0),
        TONE.bright
      )
    );
  }
  for (const flank of [-1, 1]) {
    surroundParts.push(
      part(
        new CylinderGeometry(0.42, 0.42, 21.6, 10).translate(flank * 6.5, 10.8, 0),
        TONE.stone
      )
    );
  }
  const roseSurround = new Mesh(weld(surroundParts, "rose surround"), materials.carved);
  roseSurround.position.set(0, 0, -halfDepth + 0.55);
  roseSurround.castShadow = true;
  nave2.add(roseSurround);
  const lancetParts = [];
  const lancetGlass = [];
  for (const light of [-1, 0, 1]) {
    const lancetHalf = 0.7;
    const lancetHeight = light === 0 ? 6.1 : 4.4;
    const shape = new Shape();
    shape.moveTo(-lancetHalf, 0);
    shape.lineTo(-lancetHalf, lancetHeight);
    shape.absarc(lancetHalf, lancetHeight, 2 * lancetHalf, Math.PI, Math.PI * 2 / 3, true);
    shape.absarc(-lancetHalf, lancetHeight, 2 * lancetHalf, Math.PI / 3, 0, true);
    shape.lineTo(lancetHalf, 0);
    shape.closePath();
    lancetGlass.push(
      new ExtrudeGeometry(shape, { bevelEnabled: false, depth: 0.1 }).translate(light * 2, 5, 0)
    );
    lancetParts.push(
      part(
        new BoxGeometry(0.16, lancetHeight + lancetHalf * SQRT3, 0.3).translate(
          light * 2,
          5 + (lancetHeight + lancetHalf * SQRT3) / 2,
          0.24
        ),
        TONE.bright
      )
    );
    for (const jamb of [-1, 1]) {
      lancetParts.push(
        part(
          new BoxGeometry(0.24, lancetHeight + 0.6, 0.5).translate(
            light * 2 + jamb * (lancetHalf + 0.16),
            5 + (lancetHeight + 0.6) / 2,
            0.2
          ),
          // Jambs in plain stone, not the bright tint. Six bright bars beside three bright
          // panes fused into one striped slab and the lancets stopped reading as windows.
          TONE.stone
        )
      );
    }
  }
  const lancets = new Mesh(weld(lancetGlass, "east lancets"), glass(6258372));
  lancets.position.set(0, 0, -halfDepth + 0.1);
  nave2.add(lancets);
  const lancetFrames = new Mesh(weld(lancetParts, "lancet frames"), materials.carved);
  lancetFrames.position.set(0, 0, -halfDepth + 0.1);
  nave2.add(lancetFrames);
  const canopy = new Mesh(
    part(
      piercedPanel(11, 13.9, 0.45, [{ halfWidth: 4.4, springY: 6 }]),
      TONE.stone
    ),
    materials.carved
  );
  canopy.position.set(0, 0, -halfDepth + 0.2);
  canopy.castShadow = true;
  canopy.receiveShadow = true;
  nave2.add(canopy);
  const canopyParts = [];
  const canopyFoot = new Vector2(5.4, 13.6);
  const canopyApex = 16.4;
  const canopyRun = Math.hypot(canopyFoot.x, canopyApex - canopyFoot.y);
  for (const slope of [-1, 1]) {
    canopyParts.push(
      part(
        new BoxGeometry(canopyRun + 0.35, 0.5, 0.5).rotateZ(slope * -Math.atan2(canopyApex - canopyFoot.y, canopyFoot.x)).translate(slope * canopyFoot.x / 2, (canopyFoot.y + canopyApex) / 2, 0),
        TONE.bright
      )
    );
  }
  const canopyGable = new Mesh(weld(canopyParts, "canopy gable"), materials.carved);
  canopyGable.position.set(0, 0, -halfDepth + 0.62);
  canopyGable.castShadow = true;
  nave2.add(canopyGable);
  const stepParts = [];
  for (let step = 0; step < 3; step += 1) {
    stepParts.push(
      new BoxGeometry(width * 0.82 - step * 0.7, 0.36, 1).translate(
        0,
        0.18 + step * 0.36,
        chancelZ + 2.6 - step * 1
      )
    );
  }
  stepParts.push(
    new BoxGeometry(11.6, 1.08, bayPitch * 2 + 1).translate(0, 0.54, chancelZ - bayPitch + 0.5)
  );
  const chancelFloor = new Mesh(weld(stepParts, "steps"), materials.marbleBand);
  chancelFloor.castShadow = true;
  chancelFloor.receiveShadow = true;
  nave2.add(chancelFloor);
  const altar = new Mesh(part(new BoxGeometry(4.2, 1.35, 1.9), TONE.bright), materials.carved);
  altar.position.set(0, 1.08 + 0.68, chancelZ - 6.5);
  altar.castShadow = true;
  altar.receiveShadow = true;
  nave2.add(altar);
  const screen = new InstancedMesh(new BoxGeometry(0.13, 3.4, 0.13), materials.iron, 27);
  for (let bar = 0; bar < 27; bar += 1) {
    scratch.makeRotationY(0).setPosition((bar - 13) * 0.5, 1.08 + 1.7, chancelZ - 0.8);
    screen.setMatrixAt(bar, scratch);
  }
  screen.instanceMatrix.needsUpdate = true;
  screen.castShadow = true;
  nave2.add(screen);
  const westWall = new Mesh(
    new PlaneGeometry(width + aisleWidth * 2, height),
    materials.shadowStone
  );
  westWall.position.set(0, height / 2, halfDepth);
  nave2.add(westWall);
  return nave2;
}

// probe-entry.ts
var nave = createCathedral();
nave.updateMatrixWorld(true);
var piers = nave.children[5];
var labels = /* @__PURE__ */ new Map();
var order = [
  "floor",
  "bay-walls",
  "glass-warm",
  "glass-cool",
  "glass-aisle",
  "piers",
  "aisle-walls",
  "aisle-vault-L",
  "aisle-vault-R",
  "vault-webs",
  "bay-ribs",
  "transverse-ribs",
  "bosses",
  "chancel-arch",
  "apse-back",
  "cant-L",
  "cant-R",
  "rose-glass",
  "rose-tracery",
  "rose-surround",
  "east-lancet-glass",
  "lancet-frames",
  "canopy",
  "canopy-gable",
  "chancel-floor",
  "altar",
  "screen",
  "west-wall"
];
nave.children.forEach((c, i) => labels.set(c, order[i] ?? `child-${i}`));
var pierGeom = piers.geometry;
var pos = pierGeom.getAttribute("position");
var box = new Box3();
var aboveCount = 0;
var zMinHigh = Infinity;
var zMaxHigh = -Infinity;
var xMinHigh = Infinity;
for (let i = 0; i < pos.count; i += 1) {
  const y = pos.getY(i);
  box.expandByPoint(new Vector32(pos.getX(i), y, pos.getZ(i)));
  if (y > 20) {
    aboveCount += 1;
    zMinHigh = Math.min(zMinHigh, pos.getZ(i));
    zMaxHigh = Math.max(zMaxHigh, pos.getZ(i));
    xMinHigh = Math.min(xMinHigh, pos.getX(i));
  }
}
console.log(`pier local bbox  x ${box.min.x.toFixed(2)}..${box.max.x.toFixed(2)}  y ${box.min.y.toFixed(2)}..${box.max.y.toFixed(2)}  z ${box.min.z.toFixed(2)}..${box.max.z.toFixed(2)}`);
console.log(`vertices above y=20: ${aboveCount}  their z span ${zMinHigh.toFixed(2)}..${zMaxHigh.toFixed(2)} (width ${(zMaxHigh - zMinHigh).toFixed(2)} m)  max local x ${box.max.x.toFixed(2)}`);
console.log(`  -> world |x| of the frontmost point above 20 m: ${(8.3 - box.max.x).toFixed(2)}`);
var CAMERA = new Vector32(2.6, 2.6, 22);
for (const [side, bay, light] of [[-1, 4, -1.5], [-1, 2, 1.5], [1, 4, -1.5], [-1, 6, -1.5]]) {
  const bayZ = -31.5 + bay * 7 + 3.5;
  const target = new Vector32(side * 10.08, 23, bayZ + light);
  const to = target.clone().sub(CAMERA);
  const reach = to.length();
  const hits = new Raycaster(CAMERA, to.clone().normalize(), 0.01, reach + 1).intersectObject(nave, true);
  console.log(`
ray -> side ${side > 0 ? "R" : "L"} bay ${bay} light ${light} (target z ${(bayZ + light).toFixed(1)}), reach ${reach.toFixed(1)}`);
  for (const h of hits.slice(0, 3)) {
    console.log(`   ${h.distance.toFixed(2).padStart(6)} m  ${(labels.get(h.object) ?? "?").padEnd(12)} at (${h.point.x.toFixed(2)}, ${h.point.y.toFixed(2)}, ${h.point.z.toFixed(2)})`);
  }
}
