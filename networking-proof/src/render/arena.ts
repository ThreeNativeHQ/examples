import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from "three";
import type { GameState } from "../state.js";

const LOCAL_COLOR = 0x45d6ff;
const REMOTE_COLOR = 0xff638f;
const FLOOR_COLOR = 0x12384a;

export interface IArena {
  readonly floor: Mesh;
  readonly localPlayer: Mesh;
  readonly remotePlayer: Mesh;
  readonly root: Group;
  update(state: Pick<GameState, "networkLocalX" | "networkLocalZ" | "networkPeerObserved" | "networkRemoteX" | "networkRemoteZ">): void;
  dispose(): void;
}

function cube(color: number): Mesh {
  const mesh = new Mesh(new BoxGeometry(0.7, 0.7, 0.7), new MeshStandardMaterial({ color, roughness: 0.48 }));
  mesh.castShadow = true;
  return mesh;
}

export function createArena(): IArena {
  const root = new Group();
  const floor = new Mesh(
    new BoxGeometry(12, 0.2, 8),
    new MeshStandardMaterial({ color: FLOOR_COLOR, roughness: 0.78, metalness: 0.12 }),
  );
  floor.position.y = -0.1;
  floor.receiveShadow = true;
  const localPlayer = cube(LOCAL_COLOR);
  const remotePlayer = cube(REMOTE_COLOR);
  localPlayer.visible = false;
  remotePlayer.visible = false;
  root.add(floor, localPlayer, remotePlayer);

  return {
    floor,
    localPlayer,
    remotePlayer,
    root,
    update(state) {
      localPlayer.visible = state.networkLocalX !== undefined && state.networkLocalZ !== undefined;
      if (localPlayer.visible) {
        localPlayer.position.set(state.networkLocalX ?? 0, 0.35, state.networkLocalZ ?? 0);
      }
      remotePlayer.visible = state.networkPeerObserved;
      if (remotePlayer.visible) {
        remotePlayer.position.set(state.networkRemoteX ?? 0, 0.35, state.networkRemoteZ ?? 0);
      }
    },
    dispose() {
      root.removeFromParent();
      for (const child of [floor, localPlayer, remotePlayer]) {
        child.geometry.dispose();
        const material = child.material;
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else material.dispose();
      }
    },
  };
}
