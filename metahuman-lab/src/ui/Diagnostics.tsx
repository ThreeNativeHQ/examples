import { useUiState } from "@threenative/ui";
import type { GameState } from "../state.js";

/**
 * Startup state, and the diagnostics a close-up face owes its reader.
 *
 * A face is the easiest thing in a game to be quietly wrong about, so this strip says what produced
 * the image: the rig backend and its pinned OpenRigLogic revision, the LOD and why it is pinned, the
 * counts, and what the last evaluation cost.
 *
 * The disclosure is one line and it is *accurate*, which is the whole point of it. The previous
 * wording — "Unreal shading and strand grooming are not reproduced" — was rejected as a disclaimer
 * rather than as a description, and rightly: it said what was missing without saying what was there.
 * Naming the approximation is the same sentence with the useful half kept.
 */
export function Diagnostics() {
  const state = useUiState<GameState>();
  if (state === undefined) return null;

  if (state.phase !== "ready") {
    return (
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-ink/70">
        <div className="max-w-xl border border-line bg-panel/80 p-6 text-[12px] leading-relaxed text-text">
          <h1 className="text-[11px] uppercase tracking-[0.18em] text-lume">MetaHuman expression lab</h1>
          {state.phase === "loading" ? (
            <p className="mt-3 text-dim">
              {state.stage}… the rig evaluates in this browser over the checksum-verified OpenRigLogic
              build; nothing is streamed from Unreal.
            </p>
          ) : (
            <>
              <p className="mt-3 text-warn">
                {state.phase === "missing-content" ? "no prepared specimen" : "the specimen failed to load"}
              </p>
              <p className="mt-2 whitespace-pre-line text-dim">{state.message}</p>
            </>
          )}
        </div>
      </div>
    );
  }

  const rows: readonly (readonly [string, string])[] = [
    ["rig", `${state.backend} · OpenRigLogic ${state.openRigLogic.slice(0, 7)}`],
    [
      "lod",
      state.lod === 0
        ? `0 · ${state.lodVertices.toLocaleString()} verts · source LOD0, pinned`
        : `1 · ${state.lodVertices.toLocaleString()} verts · preview, no morphs here`,
    ],
    ["counts", `${state.joints} joints · ${state.blendShapes} shapes · ${state.animatedMaps} maps`],
    ["cost", `${state.evaluationMs.toFixed(2)} ms/eval · ${state.fps.toFixed(0)} fps · frame ${state.frames}`],
  ];

  return (
    <div className="pointer-events-none absolute bottom-3 left-3 w-[24rem] rounded-md border border-line/40 bg-ink/70 px-2.5 py-2 text-[9px] tracking-[0.1em] backdrop-blur-md">
      <dl className="grid grid-cols-[3.25rem_1fr] gap-x-2 gap-y-0.5">
        {rows.map(([key, value]) => (
          <div className="contents" key={key}>
            <dt className="uppercase text-dim/70">{key}</dt>
            <dd className="truncate normal-case tabular-nums text-text/90">{value}</dd>
          </div>
        ))}
      </dl>
      {/* The disclosure, in one line, and accurate: it names the approximation instead of the gap. */}
      <p className="mt-1.5 border-t border-line/25 pt-1.5 normal-case leading-[1.45] tracking-[0.02em] text-dim/80">
        Hair: {state.strands.toLocaleString()} strands, Kajiya-Kay · Skin: sample TSL shader
      </p>
      {state.message === "" ? null : <p className="mt-1 normal-case text-warn">{state.message}</p>}
    </div>
  );
}
