/**
 * The low-draw stand-in for an airframe the render camera resolves to only a few tens of pixels.
 *
 * The recovery burst is 64 aircraft in the landing pattern plus the hulls they circle: in
 * report-REC's census one 48 px carrier cost 147 draws and one 30 px AI Devastator cost 92, because
 * every airframe is drawn as one submit per mesh — 22 meshes for a Douglas, 95 for the ported TBD.
 * Below a few tens of pixels none of that structure is resolvable, so one merged geometry in one
 * representative material is indistinguishable and costs one draw.
 *
 * Built once per airframe type at load from the already-loaded model — no reduced GLB ships and no
 * shipped bytes change. The merged geometry, its material and its average texture colour are cached
 * by airframe name and shared by every instance; only the tiny `T.Mesh` wrapper is per aircraft, so
 * releasing one aircraft never disposes another's geometry.
 *
 * One deliberate limit, measured rather than assumed: the merged mesh is static, so it is only ever
 * shown for aircraft small enough that a stopped propeller and stowed gear are not resolvable. Every
 * animated node stays on the full-detail path, which the caller keeps and toggles between.
 */
import * as T from "three";

export interface AirframeLod {
  geometry: T.BufferGeometry;
  material: T.Material;
}

/** Merged stand-ins, keyed by build (`Mitsubishi A6M3`, `Douglas TBD-1 Devastator`, `hornet`, ...). */
const cache = new Map<string, AirframeLod | null>();
/** Average texture colour, keyed by texture uuid, so a material shared by many meshes samples once. */
const textureColour = new Map<string, T.Color>();

/**
 * The merged stand-in for `full`, built and cached on first request. Null when there is nothing to merge.
 *
 * A hull reuses this: one supplied carrier is 246k–347k triangles across 94–146 meshes and, drawn
 * just inside `FAR_HULL` for a speck, costs more draw submissions than the entire parked deck load.
 * The explicit `key` lets the three US carriers that share `hornet.glb` — and any two ships of one
 * catalog class — build and share one stand-in instead of one per ship name. The geometry is baked
 * in `full`'s own local frame, so the caller shows it as a sibling of `full` inside the same parent.
 */
export function airframeLod(full: T.Object3D, key = full.name || `${full.type}#${full.id}`): AirframeLod | null {
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const built = buildLod(full);
  cache.set(key, built);
  return built;
}

/** Drop every cached stand-in. Verification switch only; the scene never calls it. */
export function clearAirframeLod(): void {
  for (const lod of cache.values()) {
    lod?.geometry.dispose();
    lod?.material.dispose();
  }
  cache.clear();
}

function buildLod(full: T.Object3D): AirframeLod | null {
  full.updateMatrixWorld(true);
  const toLocal = full.matrixWorld.clone().invert();
  const parts: T.BufferGeometry[] = [];
  let representative: T.Material | null = null;
  let heaviest = -1;
  full.traverse((node) => {
    if (!(node as T.Mesh).isMesh) return;
    const mesh = node as T.Mesh;
    const geometry = mesh.geometry as T.BufferGeometry | undefined;
    if (!geometry?.getAttribute("position")) return;
    if (Array.isArray(mesh.material)) return;
    const triangles = geometry.index ? geometry.index.count / 3 : geometry.getAttribute("position").count / 3;
    if (triangles > heaviest) {
      heaviest = triangles;
      representative = mesh.material;
    }
    // Non-indexed and position/normal/uv only: `mergeGeometries` rejects a mixed attribute set and
    // the second UV or vertex-colour channel a supplied model may carry is not worth a second draw.
    const plain = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    for (const name of Object.keys(plain.attributes))
      if (name !== "position" && name !== "normal" && name !== "uv") plain.deleteAttribute(name);
    if (!plain.getAttribute("normal")) plain.computeVertexNormals();
    if (!plain.getAttribute("uv")) {
      const count = plain.getAttribute("position").count;
      plain.setAttribute("uv", new T.Float32BufferAttribute(new Float32Array(count * 2), 2));
    }
    plain.applyMatrix4(new T.Matrix4().multiplyMatrices(toLocal, mesh.matrixWorld));
    parts.push(plain);
  });
  if (!parts.length || !representative) return null;
  const merged = mergeLod(parts);
  for (const part of parts) part.dispose();
  if (!merged) return null;
  const material = new T.MeshStandardMaterial({
    color: averageColour(representative),
    metalness: 0.05,
    roughness: 0.72,
    envMapIntensity: 0.6,
    side: (representative as T.MeshStandardMaterial).side,
  });
  return { geometry: merged, material };
}

function mergeLod(parts: T.BufferGeometry[]): T.BufferGeometry | null {
  // Written out rather than importing `mergeGeometries`, so the attribute order this file already
  // guarantees is the order it reads: fewer moving parts on the hot path is the whole point.
  let vertices = 0;
  for (const part of parts) vertices += part.getAttribute("position").count;
  const position = new Float32Array(vertices * 3);
  const normal = new Float32Array(vertices * 3);
  const uv = new Float32Array(vertices * 2);
  let at = 0;
  for (const part of parts) {
    const p = part.getAttribute("position");
    const n = part.getAttribute("normal");
    const u = part.getAttribute("uv");
    // Read component by component, not `.array`: a supplied model can hand back an interleaved
    // attribute whose backing array is not this attribute's values in order.
    for (let i = 0; i < p.count; i++) {
      position[(at + i) * 3] = p.getX(i);
      position[(at + i) * 3 + 1] = p.getY(i);
      position[(at + i) * 3 + 2] = p.getZ(i);
      normal[(at + i) * 3] = n.getX(i);
      normal[(at + i) * 3 + 1] = n.getY(i);
      normal[(at + i) * 3 + 2] = n.getZ(i);
      uv[(at + i) * 2] = u.getX(i);
      uv[(at + i) * 2 + 1] = u.getY(i);
    }
    at += p.count;
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.BufferAttribute(position, 3));
  geometry.setAttribute("normal", new T.BufferAttribute(normal, 3));
  geometry.setAttribute("uv", new T.BufferAttribute(uv, 2));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

/**
 * The colour the stand-in is drawn in.
 *
 * A flat material carries the colour outright. A mapped one has white as its colour and its whole
 * look in the texture, so the texture is averaged once into a single sRGB average and converted to
 * linear — a white Kate is exactly the "loses its markings" revert this file exists to avoid. With
 * neither, or with an image this platform cannot draw, a mid grey stands in.
 */
function averageColour(material: T.Material): T.Color {
  const standard = material as T.MeshStandardMaterial;
  if (standard.map) {
    const key = standard.map.uuid;
    const cached = textureColour.get(key);
    if (cached) return cached;
    const sampled = sampleAverage(standard.map);
    if (sampled) {
      textureColour.set(key, sampled);
      return sampled;
    }
  }
  return standard.color?.clone() ?? new T.Color(0x808080);
}

function sampleAverage(texture: T.Texture): T.Color | null {
  const image = texture.image as CanvasImageSource | undefined;
  if (!image || typeof document === "undefined") return null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 8;
    canvas.height = 8;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0, 8, 8);
    const data = context.getImageData(0, 0, 8, 8).data;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i]!;
      g += data[i + 1]!;
      b += data[i + 2]!;
    }
    const n = data.length / 4;
    return new T.Color(r / n / 255, g / n / 255, b / n / 255).convertSRGBToLinear();
  } catch {
    return null;
  }
}
