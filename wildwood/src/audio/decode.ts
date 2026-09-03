/**
 * Fetch and decode a clip, once per URL for the life of the page.
 *
 * This does not go through `ctx.assets.audio`, and the reason is the asset manifest: wildwood ships
 * `public/assets.manifest.json`, and the loader fails closed on any path the manifest does not
 * list. These files are authored straight into `public/audio/` rather than through the pipeline —
 * they are already in their shipping codec and there is nothing for a bake pass to do to them — so
 * the manifest does not know about them and never will.
 *
 * `fetch` and `AudioContext.decodeAudioData` are the two things three's own `AudioLoader` uses, and
 * the native host shims the first and binds the second, so this is the same portability the engine
 * path has.
 */

const decoded = new Map<string, Promise<AudioBuffer>>();

function url(path: string): string {
  const base = import.meta.env.BASE_URL;
  return `${base.endsWith("/") ? base : `${base}/`}${path}`;
}

export function loadClip(context: BaseAudioContext, path: string): Promise<AudioBuffer> {
  const existing = decoded.get(path);
  if (existing !== undefined) return existing;
  const pending = (async () => {
    const response = await fetch(url(path));
    if (!response.ok) throw new Error(`Audio '${path}' failed: HTTP ${String(response.status)}.`);
    return await context.decodeAudioData(await response.arrayBuffer());
  })();
  // A failed decode must not be cached as a permanent failure for a page that may recover on a
  // scene restart, and an unhandled rejection here would surface as a console error the player's
  // machine did nothing to deserve.
  pending.catch(() => decoded.delete(path));
  decoded.set(path, pending);
  return pending;
}
