// Recompile assets/ into public/ the way the dev server's watcher does — defaults, which
// means KTX2. `threenative build` reads threenative.config.ts, where this project declares
// `assets.textures: "none"`, and ships raw PNGs instead; every constant in surfaces.ts and
// every capture in artifacts/ was taken against the compressed set.
import { compileAssets, resolveBasisTranscoder } from "@threenative/assets";
const cwd = "/home/joao/projects/threenative/sandbox/lumen-hall";
let transcoder;
try { transcoder = resolveBasisTranscoder(cwd); } catch { transcoder = undefined; }
const result = await compileAssets({ cwd, ...(transcoder === undefined ? {} : { transcoder }) });
console.log(JSON.stringify(result));
