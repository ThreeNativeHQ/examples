import { defineConfig } from "vite";

declare const process: { env: Record<string, string | undefined> };

function integerSetting(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer.`);
  return value;
}

const visibility = Number(process.env.THREENATIVE_JS_PROFILE_VISIBILITY ?? "1");
if (![0, 0.25, 0.5, 1].includes(visibility)) {
  throw new Error("THREENATIVE_JS_PROFILE_VISIBILITY must be 0, 0.25, 0.5, or 1.");
}

const materials = process.env.THREENATIVE_JS_PROFILE_MATERIALS ?? "distinct";
if (materials !== "distinct") throw new Error("The fox subject requires distinct materials.");

export default defineConfig({
  define: {
    __TN_JS_ENGINE_PROFILE__: JSON.stringify({
      extraDrawControl: false,
      frameWindow: integerSetting("THREENATIVE_JS_PROFILE_FRAME_WINDOW", 300),
      materials,
      // 2,286 workload meshes is what this scene builds today; the guard in Play.ts stays
      // fail-closed against it so a changed scene cannot be reported under an old mesh count.
      meshes: integerSetting("THREENATIVE_JS_PROFILE_MESHES", 2286),
      pureJsIterations: integerSetting("THREENATIVE_JS_PROFILE_PURE_JS_ITERATIONS", 0),
      pureJsObjects: integerSetting("THREENATIVE_JS_PROFILE_PURE_JS_OBJECTS", 2358),
      visibility,
      warmupFrames: integerSetting("THREENATIVE_JS_PROFILE_WARMUP_FRAMES", 120),
    }),
  },
});
