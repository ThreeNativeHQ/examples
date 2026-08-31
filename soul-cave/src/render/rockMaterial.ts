// Ordinary Three.js/TSL: the framework decides none of this.
//
// The Fab pack ships no albedo texture for its rock. Unreal's `M_Cave_Rock_MASTER` blends tiling
// detail materials through a packed mask, so the importer correctly refused to paint the models
// with that mask — it is three unrelated channels, not a photograph, and binding it is what turned
// the cave magenta. The mask is still the best description of the surface anyone has, so the
// material is rebuilt here, which is where a look decision belongs.
//
// What each channel turned out to carry, read off the extracted texture:
//   R  broad rock-face coverage — high on the stone, low in the crevices between blocks
//   G  edge and crack highlights — the thin bright seams
//   B  the base blend weight, high nearly everywhere and lower where the surface is worn
import {
  Color,
  type MeshStandardMaterial,
  type Texture,
  Vector2,
} from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { float, mix, texture, uv, vec2, vec3 } from "three/tsl";
import { DoubleSide, Group, Mesh, Path, PlaneGeometry, RepeatWrapping, Shape, ShapeGeometry } from "three";

/** Damp limestone, warm in the light and blue-grey in shadow — the reference's palette. */
const CREVICE = new Color(0x1a1310);
const STONE = new Color(0x8b7757);
const EDGE = new Color(0xb8a883);
const DAMP = new Color(0x2e2a20);
/** The reference's rock is green wherever water runs down it. */
const MOSS = new Color(0x3f4a24);

export interface IRockMaterialOptions {
  readonly maskMap: Texture;
  /** Carried over from the imported material, which did resolve a real normal map. */
  readonly normalMap: Texture | null;
  /** Tints the whole surface; the moss variants sit greener than the dry stone. */
  readonly tint?: Color;
}

/**
 * Builds the rock surface from the mask the importer could not bind.
 *
 * Runs on the GPU as a node material rather than baking a texture, so the palette stays a value
 * anyone can edit and no second copy of a 1K image ships with the game.
 */
export function createRockMaterial(options: IRockMaterialOptions): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  // Two samples at unrelated scales, blended. A single tiled sample of a mask with features this
  // distinctive reads as wallpaper the moment it repeats — which across a floor is every two
  // metres. The second, coarser sample breaks the grid without needing a second texture.
  const near = texture(options.maskMap, uv());
  const far = texture(options.maskMap, uv().mul(0.23).add(vec2(0.37, 0.71)));
  const mask = near.mul(0.62).add(far.mul(0.38));

  // Crevices are dark and matte, faces are lit stone, seams catch a lighter mineral. The red
  // channel is pushed through a curve first: it sits in a narrow band over most of the surface,
  // and used raw it produces one flat tone where the reference has deep relief.
  const faces = mask.r.mul(mask.r).mul(3).sub(mask.r.mul(mask.r).mul(mask.r).mul(2)).clamp(0, 1);
  let albedo = mix(vec3(CREVICE.r, CREVICE.g, CREVICE.b), vec3(STONE.r, STONE.g, STONE.b), faces);
  albedo = mix(albedo, vec3(EDGE.r, EDGE.g, EDGE.b), mask.g.mul(0.7));
  // Where the base blend falls away the rock is worn and damp rather than freshly broken.
  albedo = mix(albedo, vec3(DAMP.r, DAMP.g, DAMP.b), float(1).sub(mask.b).mul(0.55));
  // Moss gathers in the crevices the red channel calls unlit, and only on the damp half.
  const moss = float(1).sub(faces).mul(float(1).sub(mask.b)).mul(0.85).clamp(0, 1);
  albedo = mix(albedo, vec3(MOSS.r, MOSS.g, MOSS.b), moss);
  if (options.tint) {
    albedo = albedo.mul(vec3(options.tint.r, options.tint.g, options.tint.b));
  }
  material.colorNode = albedo;

  // Wet rock is smoother in the worn places and rough on the broken faces.
  material.roughnessNode = mix(float(0.55), float(0.96), faces);
  material.metalnessNode = float(0);

  if (options.normalMap) {
    material.normalMap = options.normalMap;
    // Photoscanned rock at cave scale needs the relief pushed to read at all under one hard light.
    material.normalScale = new Vector2(1.8, 1.8);
  }
  material.side = 0;
  return material;
}

/** Copies what the imported material already got right onto the rebuilt one. */
export function inheritFrom(
  source: MeshStandardMaterial,
  rebuilt: MeshStandardNodeMaterial,
): void {
  rebuilt.name = `${source.name}_rebuilt`;
  rebuilt.alphaTest = source.alphaTest;
  rebuilt.transparent = source.transparent;
  rebuilt.side = source.side;
}



function tiled(map: Texture | null, tiles: number): Texture | null {
  if (!map) return null;
  const copy = map.clone();
  copy.wrapS = RepeatWrapping;
  copy.wrapT = RepeatWrapping;
  copy.repeat.set(tiles, tiles);
  copy.needsUpdate = true;
  return copy;
}

export interface ICaveShellOptions {
  readonly maskMap: Texture;
  readonly normalMap: Texture | null;
  /** Inside dimension of the chamber, in metres. */
  readonly sizeMetres: number;
  readonly heightMetres: number;
  /** The opening in the roof the daylight falls through. */
  readonly hole: { readonly x: number; readonly z: number; readonly width: number; readonly depth: number };
}

/**
 * Floor, four walls, and a roof with a hole in it.
 *
 * The pack's merged rock masses are 70 m blocks meant to be seen from outside; standing inside one
 * puts the camera in undifferentiated rock and nothing occludes the sun, which flattened every
 * earlier version of this scene. The room itself is therefore built here, wearing the same rebuilt
 * rock surface as everything else, and the imported meshes stand inside it as furniture.
 *
 * Tiling is deliberately fine — a mask stretched once across ninety metres reads as a checkerboard,
 * which is exactly what it looked like at eleven metres per tile.
 */
export function createCaveShell(options: ICaveShellOptions): Group {
  const { sizeMetres: size, heightMetres: height } = options;
  const half = size / 2;
  const group = new Group();
  group.name = "caveShell";

  const surface = (tiles: number, tint?: Color, roughness?: number): MeshStandardNodeMaterial => {
    const material = createRockMaterial({
      maskMap: tiled(options.maskMap, tiles) as Texture,
      normalMap: tiled(options.normalMap, tiles),
      ...(tint ? { tint } : {}),
    });
    if (roughness !== undefined) material.roughnessNode = float(roughness);
    material.side = DoubleSide;
    return material;
  };

  const floor = new Mesh(new PlaneGeometry(size, size), surface(size / 2.2, new Color(0.62, 0.6, 0.58), 0.42));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.name = "caveFloor";
  group.add(floor);

  const wallMaterial = surface(size / 3);
  for (const [index, [x, z, rotation]] of (
    [
      [0, -half, 0],
      [0, half, Math.PI],
      [-half, 0, Math.PI / 2],
      [half, 0, -Math.PI / 2],
    ] as const
  ).entries()) {
    // Exactly roof height: a wall that overshoots is what the roof hole shows instead of sky.
    const wall = new Mesh(new PlaneGeometry(size, height), wallMaterial);
    wall.position.set(x, height / 2, z);
    wall.rotation.y = rotation;
    wall.receiveShadow = true;
    wall.castShadow = true;
    wall.name = `caveWall${index}`;
    group.add(wall);
  }

  const outline = new Shape()
    .moveTo(-half, -half)
    .lineTo(half, -half)
    .lineTo(half, half)
    .lineTo(-half, half)
    .lineTo(-half, -half);
  const { x, z, width, depth } = options.hole;
  outline.holes.push(
    new Path()
      .moveTo(x - width / 2, z - depth / 2)
      .lineTo(x - width / 2, z + depth / 2)
      .lineTo(x + width / 2, z + depth / 2)
      .lineTo(x + width / 2, z - depth / 2)
      .lineTo(x - width / 2, z - depth / 2),
  );
  const geometry = new ShapeGeometry(outline);
  // ShapeGeometry lays UVs out in world units; bring them back to the same tiling as the walls.
  const uvAttribute = geometry.getAttribute("uv");
  const roofTiles = size / 3;
  for (let index = 0; index < uvAttribute.count; index += 1) {
    uvAttribute.setXY(
      index,
      (uvAttribute.getX(index) / size) * roofTiles,
      (uvAttribute.getY(index) / size) * roofTiles,
    );
  }
  uvAttribute.needsUpdate = true;

  const roof = new Mesh(geometry, surface(1));
  // Rotating the shape flat maps its local +Y to world +Z, and points its front face down at
  // the room; the sun is above, so both faces have to exist.
  roof.rotation.x = Math.PI / 2;
  roof.position.y = height;
  roof.castShadow = true;
  roof.receiveShadow = true;
  roof.name = "caveRoof";
  group.add(roof);

  return group;
}
