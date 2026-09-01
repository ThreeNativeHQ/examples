import type { Material, Object3D } from "three";
import { Color, Mesh, MeshStandardMaterial } from "three";

/**
 * Recolour a cloned mannequin without touching the shared source material.
 *
 * Two materials come off this asset: the body and its joints. The joints are the knuckles, elbows
 * and knees, so painting them a saturated accent turns a pair of hands into a cluster of coloured
 * blobs — the accent is mixed most of the way back into the body colour, leaving just enough hue
 * to tell one host from another across the room.
 */
export function tintMannequin(root: Object3D, colour: number): void {
  const body = new Color(0x39383d);
  const accent = new Color(colour).lerp(body, 0.55);
  root.traverse((object) => {
    if (!(object instanceof Mesh) || object.name === "worker-pick-proxy") return;
    object.castShadow = true;
    object.receiveShadow = true;
    const materials: Material[] = Array.isArray(object.material)
      ? object.material
      : [object.material];
    const painted = materials.map((material) => {
      const copy = material.clone();
      if (copy instanceof MeshStandardMaterial) {
        const joints = /joint/i.test(material.name);
        copy.color = joints ? accent.clone() : body.clone();
        copy.roughness = joints ? 0.7 : 0.85;
        copy.metalness = 0;
      }
      return copy;
    });
    object.material = painted.length === 1 ? (painted[0] as Material) : painted;
  });
}
