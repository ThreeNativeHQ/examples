// Generated for you: ordinary Three.js; ThreeNative does not read this file.
import { ACESFilmicToneMapping } from "three";
type OutputRenderer = {
  raw: unknown;
};

export function setupPost(renderer: OutputRenderer): void {
  const raw = renderer.raw as { toneMapping?: number; toneMappingExposure?: number };
  raw.toneMapping = ACESFilmicToneMapping;
  raw.toneMappingExposure = 1.14;
}
