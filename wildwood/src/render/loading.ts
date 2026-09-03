import {
  type Camera,
  CanvasTexture,
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  type OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  type Scene,
  type Texture,
  UnsignedByteType,
} from "three";

/* BEGIN THREENATIVE LOADING APPEARANCE */
/** Edit these source constants for the starter's loading look. */
export const loading = {
  backgroundColor: 0x08110c,
  backgroundImage: undefined as string | undefined,
  enabled: true,
  fillImage: undefined as string | undefined,
  logoImage: undefined as string | undefined,
  progressColor: 0xd89847,
  showStatus: true,
  trackColor: 0x1b3023,
  bar: { anchorX: 0.5, anchorY: 0.78, height: 8, maxWidth: 440, minWidth: 1, width: 0.54 },
} as const;
/* END THREENATIVE LOADING APPEARANCE */

interface ILoadingHost {
  readonly assets?: { texture(path: string): Promise<Texture> };
  readonly canvasLayer: {
    readonly camera: OrthographicCamera;
    readonly scene: Scene;
    opaque: boolean;
  };
  readonly renderer: { renderOverlay(scene: Scene, camera: Camera): void };
  readonly startup: { readonly progress: number; whenReady(): Promise<void> };
  readonly viewport?: {
    readonly safeArea: { height: number; width: number; x: number; y: number };
    resize?(): void;
  };
}

/**
 * This screen waits on `host.startup.whenReady()` and nothing else, which is the whole point.
 *
 * It used to carry its own second gate: an `until` promise, a budget, and a two-phase progress bar
 * that mapped the framework's readiness into the first 72% so the fill would not sit full while
 * the game's own asset tier landed. All of that existed because the framework's readiness covered
 * the framework's work and had no seam for a game's own, so a game streaming a detail tier had to
 * hold the curtain past `whenReady()` by hand — and every framework-owned observation of startup
 * then described a moment the player never reached.
 *
 * `ctx.startup.hold()` closed that gap, so the scene registers its tier with the gate
 * (`Valley.ts`) and this file went back to being a loading screen: 45 lines of curtain-holding
 * deleted, and `host.startup.progress` spans the whole wait on its own again.
 */
interface ILoadingOptions {
  /**
   * Called once, on the frame the curtain lifts **to show the world**. This is the only moment at
   * which "what the player first saw" can be sampled, and it stays the game's business — the
   * framework knows when it is ready, not what the game put on screen.
   *
   * Not called when the curtain comes down because the scene is being torn down. `finish()` is the
   * public teardown and `exit()` calls it, so a callback wired to it fires on every scene exit and
   * HMR reload with whatever half-built state happens to exist — observed as
   * `TN_VALLEY_REVEAL trees=1 ferns=0`, which is precisely the reading this callback exists to
   * disprove.
   */
  readonly onReveal?: () => void;
  /** Progress across the game's own held window, when the game can report it more finely. */
  readonly holdProgress?: () => number;
}

interface ILoadingController {
  update(): void;
  finish(): void;
}

function noOp(
  layer: ILoadingHost["canvasLayer"],
  options: ILoadingOptions,
): ILoadingController {
  layer.opaque = false;
  options.onReveal?.();
  return { finish: () => undefined, update: () => undefined };
}

function meshFor(
  layer: ILoadingHost["canvasLayer"],
  material: MeshBasicMaterial,
  renderOrder: number,
): Mesh<PlaneGeometry, MeshBasicMaterial> {
  const mesh = new Mesh(new PlaneGeometry(1, 1), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = renderOrder;
  layer.scene.add(mesh);
  return mesh;
}

function imageAspect(texture: Texture | null | undefined): number {
  const image = texture?.image as { height?: number; width?: number } | undefined;
  const width = image?.width ?? 1;
  const height = image?.height ?? 1;
  return width > 0 && height > 0 ? width / height : 1;
}

function configureTexture(texture: Texture): void {
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.needsUpdate = true;
}

/** Native-safe pixel fallback for the same forest field and warm trail. */
function forestPixelTexture(): DataTexture {
  const width = 320;
  const height = 180;
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const depth = y / height;
      const treeLine = 104 - ((x * 37) % 29);
      const forest = y > treeLine;
      const trailCentre = width / 2 + Math.sin((height - y) * 0.055) * (height - y) * 0.18;
      const trail = y > 108 && Math.abs(x - trailCentre) < 2 + depth * 3;
      // A stable hash gives the native-safe field the same lichen mottling as the canvas path.
      const lichen = ((x * 73_856_093) ^ (y * 19_349_663)) >>> 28;
      pixels[offset] = trail ? 216 : forest ? 8 + lichen / 4 : Math.round(19 - depth * 11 + lichen / 3);
      pixels[offset + 1] = trail ? 152 : forest ? 22 + lichen : Math.round(39 - depth * 24 + lichen);
      pixels[offset + 2] = trail ? 71 : forest ? 15 + lichen / 2 : Math.round(28 - depth * 18 + lichen / 2);
      pixels[offset + 3] = 255;
    }
  }
  const texture = new DataTexture(pixels, width, height, RGBAFormat, UnsignedByteType);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  configureTexture(texture);
  return texture;
}

/** Game-owned forest art, generated synchronously so it adds no critical network request. */
function forestBackdropTexture(): Texture {
  if (typeof document === "undefined") return forestPixelTexture();
  const canvas = document.createElement("canvas");
  canvas.width = 960;
  canvas.height = 540;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("The loading illustration needs a 2D canvas context.");

  const sky = context.createLinearGradient(0, 0, 0, canvas.height);
  sky.addColorStop(0, "#13271c");
  sky.addColorStop(0.58, "#0a1710");
  sky.addColorStop(1, "#050b08");
  context.fillStyle = sky;
  context.fillRect(0, 0, canvas.width, canvas.height);

  // Subtle deterministic lichen colonies keep the field organic without a network texture.
  for (let index = 0; index < 180; index += 1) {
    const roll = ((index * 7_919 + 31 * 104_729) % 10_007) / 10_007;
    const rollY = ((index * 13_163 + 47 * 65_537) % 10_009) / 10_009;
    context.fillStyle = `rgba(93, 128, 75, ${String(0.025 + roll * 0.055)})`;
    context.beginPath();
    context.ellipse(
      roll * canvas.width,
      rollY * canvas.height,
      10 + rollY * 42,
      4 + roll * 17,
      roll * Math.PI,
      0,
      Math.PI * 2,
    );
    context.fill();
  }

  // Three silhouette bands make a real valley rather than a flat colour field.
  const forestBand = (baseline: number, color: string, count: number, seed: number): void => {
    context.fillStyle = color;
    for (let index = 0; index < count; index += 1) {
      const roll = ((index * 7_919 + seed * 104_729) % 10_007) / 10_007;
      const x = (index / Math.max(1, count - 1)) * canvas.width + (roll - 0.5) * 30;
      const height = 55 + roll * 145;
      const width = 18 + roll * 28;
      context.beginPath();
      context.moveTo(x, baseline - height);
      context.lineTo(x - width, baseline);
      context.lineTo(x + width, baseline);
      context.closePath();
      context.fill();
      context.fillRect(x - 3, baseline - height * 0.55, 6, height * 0.7);
    }
  };
  forestBand(330, "#1b3525", 23, 5);
  forestBand(400, "#10251a", 29, 11);
  forestBand(475, "#09160f", 34, 17);

  // The only warm mark: a trail curling from the player into the dark tree line.
  context.strokeStyle = "#d89847";
  context.lineCap = "round";
  context.lineWidth = 14;
  context.beginPath();
  context.moveTo(495, 560);
  context.bezierCurveTo(535, 470, 390, 430, 487, 340);
  context.stroke();
  context.strokeStyle = "#f0b75f";
  context.lineWidth = 3;
  context.stroke();

  context.fillStyle = "#e6d9b7";
  context.font = "600 42px ui-monospace, monospace";
  context.textAlign = "center";
  context.fillText("WILDWOOD", canvas.width / 2, 116);
  context.fillStyle = "#91a68f";
  context.font = "500 16px ui-monospace, monospace";
  context.fillText("THE VALLEY IS WAKING", canvas.width / 2, 146);

  const texture = new CanvasTexture(canvas);
  configureTexture(texture);
  return texture;
}

function setFillUv(geometry: PlaneGeometry, progress: number, base: readonly number[]): void {
  const uv = geometry.getAttribute("uv");
  for (let index = 0; index < uv.count; index += 1) uv.setX(index, (base[index] ?? 0) * progress);
  uv.needsUpdate = true;
}

function coverUv(
  geometry: PlaneGeometry,
  texture: Texture,
  width: number,
  height: number,
  baseU: readonly number[],
  baseV: readonly number[],
): void {
  const imageRatio = imageAspect(texture);
  const boxRatio = width / Math.max(1, height);
  const visibleU = imageRatio > boxRatio ? boxRatio / imageRatio : 1;
  const visibleV = imageRatio < boxRatio ? imageRatio / boxRatio : 1;
  const offsetU = (1 - visibleU) / 2;
  const offsetV = (1 - visibleV) / 2;
  const uv = geometry.getAttribute("uv");
  for (let index = 0; index < uv.count; index += 1) {
    uv.setX(index, offsetU + (baseU[index] ?? 0) * visibleU);
    uv.setY(index, offsetV + (baseV[index] ?? 0) * visibleV);
  }
  uv.needsUpdate = true;
}

function statusMesh(
  layer: ILoadingHost["canvasLayer"],
):
  | { mesh: Mesh<PlaneGeometry, MeshBasicMaterial>; texture: Texture; update(value: number): void }
  | undefined {
  if (!loading.showStatus || typeof document === "undefined") return undefined;
  const canvas = document.createElement("canvas");
  canvas.width = 440;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context === null) return undefined;
  const texture = new CanvasTexture(canvas);
  const mesh = meshFor(
    layer,
    new MeshBasicMaterial({ depthTest: false, depthWrite: false, map: texture, transparent: true }),
    4,
  );
  const update = (value: number): void => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#c9d2bd";
    context.font = "600 17px ui-monospace, monospace";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(
      `PREPARING TERRAIN · ${String(Math.round(value * 100)).padStart(2, "0")}%`,
      canvas.width / 2,
      canvas.height / 2,
    );
    texture.needsUpdate = true;
  };
  update(0);
  return { mesh, texture, update };
}

export function createLoadingScreen(
  host: ILoadingHost,
  options: ILoadingOptions = {},
): ILoadingController {
  const layer = host.canvasLayer;
  if (!loading.enabled) return noOp(layer, options);
  host.viewport?.resize?.();
  const camera = layer.camera;
  const authoredBackdrop = forestBackdropTexture();
  const backdrop = meshFor(
    layer,
    new MeshBasicMaterial({
      color: 0xffffff,
      depthTest: false,
      depthWrite: false,
      map: authoredBackdrop,
    }),
    0,
  );
  const track = meshFor(
    layer,
    new MeshBasicMaterial({ color: loading.trackColor, depthTest: false, depthWrite: false }),
    1,
  );
  const fill = meshFor(
    layer,
    new MeshBasicMaterial({ color: loading.progressColor, depthTest: false, depthWrite: false }),
    2,
  );
  const fillBaseU = Array.from({ length: fill.geometry.getAttribute("uv").count }, (_, index) =>
    fill.geometry.getAttribute("uv").getX(index),
  );
  const fillBaseV = Array.from({ length: fill.geometry.getAttribute("uv").count }, (_, index) =>
    fill.geometry.getAttribute("uv").getY(index),
  );
  const logo =
    loading.logoImage === undefined
      ? undefined
      : meshFor(
          layer,
          new MeshBasicMaterial({
            color: 0xffffff,
            depthTest: false,
            depthWrite: false,
            transparent: true,
          }),
          3,
        );
  const status = statusMesh(layer);
  const parts = [
    backdrop,
    track,
    fill,
    ...(logo === undefined ? [] : [logo]),
    ...(status === undefined ? [] : [status.mesh]),
  ];
  const ownedTextures = new Set<Texture>([
    authoredBackdrop,
    ...(status === undefined ? [] : [status.texture]),
  ]);
  let width = 1;
  let height = 1;
  let barWidth = 1;
  let barHeight: number = loading.bar.height;
  let barX = 0;
  let barY = 0;
  let progress = 0;
  let done = false;
  let backdropTexture: Texture | undefined = authoredBackdrop;
  let layoutTimer: ReturnType<typeof setTimeout> | undefined;

  const layout = (): void => {
    width = Math.max(1, camera.right - camera.left);
    height = Math.max(1, camera.top - camera.bottom);
    const safe = host.viewport?.safeArea ?? { height, width, x: 0, y: 0 };
    const safeWidth = Math.max(1, Math.min(width, safe.width));
    const safeHeight = Math.max(1, Math.min(height, safe.height));
    const safeX = Math.max(0, Math.min(width - safeWidth, safe.x));
    const safeY = Math.max(0, Math.min(height - safeHeight, safe.y));
    barWidth = Math.max(2, Math.min(loading.bar.maxWidth, safeWidth * loading.bar.width));
    barHeight = Math.max(2, Math.min(loading.bar.height, safeHeight * 0.05));
    barX = safeX + safeWidth * loading.bar.anchorX;
    barY = safeY + safeHeight * loading.bar.anchorY;
    const worldX = (screenX: number): number => camera.left + screenX;
    const worldY = (screenY: number): number => camera.top - screenY;
    const visibleWidth = Math.max(loading.bar.minWidth, barWidth * progress);
    backdrop.scale.set(width, height, 1);
    backdrop.position.set(worldX(width / 2), worldY(height / 2), 0);
    track.scale.set(barWidth, barHeight, 1);
    track.position.set(worldX(barX), worldY(barY), 0);
    fill.scale.set(visibleWidth, barHeight, 1);
    fill.position.set(worldX(barX - barWidth / 2 + visibleWidth / 2), worldY(barY), 0);
    if (logo?.visible) {
      const logoWidth = Math.min(safeWidth * 0.42, 280);
      logo.scale.set(
        logoWidth,
        Math.min(logoWidth / imageAspect(logo.material.map), safeHeight * 0.22),
        1,
      );
      logo.position.set(worldX(barX), worldY(Math.max(safeY, barY - safeHeight * 0.2)), 0);
    }
    if (status !== undefined) {
      status.mesh.scale.set(Math.min(180, safeWidth * 0.32), 48, 1);
      status.mesh.position.set(worldX(barX), worldY(Math.min(height, barY + barHeight * 2.5)), 0);
    }
    if (backdropTexture !== undefined)
      coverUv(backdrop.geometry, backdropTexture, width, height, fillBaseU, fillBaseV);
  };

  const updateProgress = (value: number): void => {
    progress = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
    setFillUv(fill.geometry, progress, fillBaseU);
    status?.update(progress);
    layout();
  };

  const attachTexture = (mesh: Mesh<PlaneGeometry, MeshBasicMaterial>, texture: Texture): void => {
    if (done) return;
    configureTexture(texture);
    mesh.material.map = texture;
    mesh.material.color.set(0xffffff);
    mesh.material.needsUpdate = true;
    ownedTextures.add(texture);
    if (mesh === backdrop) backdropTexture = texture;
    layout();
    updateProgress(progress);
  };

  const load = (source: string | undefined, mesh: Mesh<PlaneGeometry, MeshBasicMaterial>): void => {
    if (source === undefined || host.assets === undefined) return;
    void host.assets
      .texture(source)
      .then((texture) => attachTexture(mesh, texture))
      .catch(() => undefined);
  };
  load(loading.backgroundImage, backdrop);
  load(loading.fillImage, fill);
  if (logo !== undefined && loading.logoImage !== undefined && host.assets !== undefined) {
    void host.assets
      .texture(loading.logoImage)
      .then((texture) => {
        if (done) return;
        configureTexture(texture);
        logo.material.map = texture;
        logo.material.needsUpdate = true;
        logo.visible = true;
        ownedTextures.add(texture);
        layout();
      })
      .catch(() => undefined);
  }

  layer.opaque = true;
  layout();
  updateProgress(0);
  host.renderer.renderOverlay(layer.scene, layer.camera);

  // The CanvasLayer camera receives its real viewport after Scene.load() starts. Keep the authored
  // mesh fitted during that async window; enter() cannot call controller.update() until critical
  // assets resolve. The cancelled timer works in the native host as well as the browser.
  const maintainLayout = (): void => {
    if (done) return;
    updateProgress(currentProgress());
    host.renderer.renderOverlay(layer.scene, layer.camera);
    layoutTimer = setTimeout(maintainLayout, 16);
  };
  layoutTimer = setTimeout(maintainLayout, 0);
  const announcePresentedView = (): void => {
    if (done) return;
    updateProgress(currentProgress());
    host.renderer.renderOverlay(layer.scene, layer.camera);
    console.info(
      `TN_LOADING_VIEW_READY viewport=${String(camera.right - camera.left)}x${String(camera.top - camera.bottom)} theme=wildwood-lichen-forest source=${typeof document === "undefined" ? "pixels" : "canvas"}`,
    );
  };
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => requestAnimationFrame(announcePresentedView));
  } else {
    setTimeout(announcePresentedView, 32);
  }

  // One source for the fill. `host.startup.progress` now spans the game's held tier as well as the
  // framework's own work, so the only thing left for the game to add is a finer reading of its own
  // window than "one hold, settled or not" — which is what `holdProgress` is, and it is optional.
  const currentProgress = (): number => {
    const framework = host.startup.progress;
    const finer = options.holdProgress?.();
    if (finer === undefined || framework < 0.9) return framework;
    return Math.max(framework, 0.9 + 0.1 * Math.min(1, Math.max(0, finer)));
  };

  const teardown = (revealed: boolean): void => {
    if (done) return;
    done = true;
    if (revealed) options.onReveal?.();
    if (layoutTimer !== undefined) clearTimeout(layoutTimer);
    for (const mesh of parts) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    for (const texture of ownedTextures) texture.dispose();
    layer.opaque = false;
  };

  void (async () => {
    // The gate the scene registered its detail tier with. Nothing else to wait for.
    await host.startup.whenReady();
    if (done) return;
    teardown(true);
  })();

  return {
    // The public `finish` is teardown, and it never reports a reveal.
    finish: () => {
      teardown(false);
    },
    update(): void {
      if (done) return;
      updateProgress(currentProgress());
      // The frame loop runs before readiness — that is how the framework measures its own stable
      // frame window — so this both advances the fill and keeps the curtain presented for as long
      // as the gate is still closed, which is now the game's asset tier as well.
      host.renderer.renderOverlay(layer.scene, layer.camera);
      if (layoutTimer !== undefined) {
        clearTimeout(layoutTimer);
        layoutTimer = undefined;
      }
    },
  };
}
