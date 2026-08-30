import { Scene } from "@threenative/core";
import type { GameState } from "../state.js";
import { Level } from "./Level.js";
import type { GameCtx } from "./Level.js";

export class Boot extends Scene<GameState, GameCtx["physics"]> {
  static override readonly initialState = Level.initialState;

  override enter(ctx: GameCtx): void {
    // TEMPORARY PROBE (PRD-228): why does surface().sampleCount report 1 when the config asks
    // for antialias? Prints what three actually holds, beside what the wrapper reports.
    const raw = (ctx.renderer as unknown as { raw: Record<string, unknown> }).raw;
    console.info(
      `TN_AA_PROBE:${JSON.stringify({
        kind: (ctx.renderer as unknown as { kind: string }).kind,
        rawSamples: raw?.samples,
        rawSamplesType: typeof raw?.samples,
        privateSamples: (raw as { _samples?: number })?._samples,
        trackTimestamp: (raw as { backend?: { trackTimestamp?: boolean } })?.backend
          ?.trackTimestamp,
        hasTimestampFeature: (
          raw as { backend?: { device?: { features?: { has?: (n: string) => boolean } } } }
        )?.backend?.device?.features?.has?.("timestamp-query"),
        dpr: globalThis.devicePixelRatio,
        innerWidth: globalThis.innerWidth,
        canvasClientWidth: (ctx.renderer.domElement as { clientWidth?: number }).clientWidth,
        canvasWidth: (ctx.renderer.domElement as { width?: number }).width,
        compatibilityMode: (raw as { backend?: { compatibilityMode?: boolean } })?.backend
          ?.compatibilityMode,
        hasCoreFeatures: (
          raw as { backend?: { device?: { features?: { has?: (n: string) => boolean } } } }
        )?.backend?.device?.features?.has?.("core-features-and-limits"),
        surface: ctx.renderer.surface(),
      })}`,
    );
    void ctx.goto("level");
  }
}
