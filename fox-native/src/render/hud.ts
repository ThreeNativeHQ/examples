import * as THREE from "three";

/**
 * On-canvas HUD and touch controls.
 *
 * The DOM HUD in `main.ts` is web-only: on the native host `document` is a Three.js
 * compatibility stub, so nothing appended to it ever renders. Everything a player must see
 * on every platform is therefore built from Three.js geometry and parented to the camera, so
 * it draws in the same pass as the world with no second render and no canvas texture.
 *
 * Layout is authored in pixels with the origin at the top-left, matching pointer coordinates,
 * so hit-testing a button is a rectangle test against `input.raw.pointers` with no unproject.
 */

const INK = 0x123043;
const GOLD = 0xffd23f;
const GOLD_DARK = 0xd79a17;
const HEART_RED = 0xef3b36;
const HEART_EMPTY = 0x4b5a66;
const PANEL = 0xffffff;
const GEM_BLUE = 0x3fa9f5;

/** Seven-segment layout: which segments each digit lights, a..g. */
const DIGITS: readonly (readonly boolean[])[] = [
  [true, true, true, true, true, true, false],
  [false, true, true, false, false, false, false],
  [true, true, false, true, true, false, true],
  [true, true, true, true, false, false, true],
  [false, true, true, false, false, true, true],
  [true, false, true, true, false, true, true],
  [true, false, true, true, true, true, true],
  [true, true, true, false, false, false, false],
  [true, true, true, true, true, true, true],
  [true, true, true, true, false, true, true],
];

/**
 * Every HUD material is transparent and depth-free on purpose: transparent objects render
 * after the opaque world, so the overlay is guaranteed to sit on top of it without a second
 * render pass or a cleared depth buffer.
 */
function flat(color: number, opacity = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    depthTest: false,
    depthWrite: false,
    fog: false,
    opacity,
    side: THREE.DoubleSide,
    transparent: true,
  });
}

function quad(width: number, height: number, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.frustumCulled = false;
  return mesh;
}

function disc(radius: number, material: THREE.Material, segments = 24): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, segments), material);
  mesh.frustumCulled = false;
  return mesh;
}

function ring(radius: number, thickness: number, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.RingGeometry(radius - thickness, radius, 28),
    material,
  );
  mesh.frustumCulled = false;
  return mesh;
}

function heartShape(): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, -0.5);
  shape.bezierCurveTo(0.75, -1.15, 1.1, -0.25, 0, 0.55);
  shape.bezierCurveTo(-1.1, -0.25, -0.75, -1.15, 0, -0.5);
  return new THREE.ShapeGeometry(shape, 12);
}

const HEART_GEOMETRY = heartShape();

/** One seven-segment digit, drawn from `size` pixels tall. */
class Digit {
  readonly group = new THREE.Group();
  readonly #segments: THREE.Mesh[] = [];

  constructor(size: number, material: THREE.Material) {
    const t = Math.max(2, size * 0.16);
    const w = size * 0.62;
    const h = size;
    // a top, b top-right, c bottom-right, d bottom, e bottom-left, f top-left, g middle
    const layout: readonly (readonly [number, number, number, number])[] = [
      [w / 2, t / 2, w - t, t],
      [w - t / 2, h / 4 + t / 4, t, h / 2 - t],
      [w - t / 2, (h * 3) / 4 - t / 4, t, h / 2 - t],
      [w / 2, h - t / 2, w - t, t],
      [t / 2, (h * 3) / 4 - t / 4, t, h / 2 - t],
      [t / 2, h / 4 + t / 4, t, h / 2 - t],
      [w / 2, h / 2, w - t, t],
    ];
    for (const [x, y, sw, sh] of layout) {
      const segment = quad(sw, sh, material);
      segment.position.set(x, y, 0);
      this.group.add(segment);
      this.#segments.push(segment);
    }
    this.group.userData.width = w;
  }

  set(value: number | null): void {
    const pattern = value === null ? undefined : DIGITS[value];
    for (const [index, segment] of this.#segments.entries())
      segment.visible = pattern?.[index] === true;
  }
}

class Counter {
  readonly group = new THREE.Group();
  readonly #digits: Digit[];

  constructor(count: number, size: number, material: THREE.Material) {
    this.#digits = Array.from({ length: count }, (_unused, index) => {
      const digit = new Digit(size, material);
      digit.group.position.x = index * size * 0.78;
      this.group.add(digit.group);
      return digit;
    });
  }

  set(value: number, padded = false): void {
    const text = String(Math.max(0, Math.floor(value))).padStart(
      padded ? this.#digits.length : 1,
      "0",
    );
    const offset = this.#digits.length - text.length;
    for (const [index, digit] of this.#digits.entries()) {
      const character = index < offset ? undefined : text[index - offset];
      digit.set(character === undefined ? null : Number(character));
    }
  }
}

export interface HudState {
  readonly coins: number;
  readonly gemTotal: number;
  readonly gems: number;
  readonly hearts: number;
  readonly time: number;
}

/**
 * Every finger currently down, tracked by pointer id.
 *
 * `ctx.input.raw.pointer` is a single primary cursor, so it cannot express holding the stick
 * and pressing jump at once. The host dispatches ordinary `PointerEvent`s with a `pointerId`
 * on every platform, so the same fifteen lines work in the browser, on desktop and on
 * Android — no per-platform branch and no touch library.
 */
export class Pointers {
  readonly active = new Map<number, THREE.Vector2>();
  readonly #listeners: [string, EventListener][] = [];

  constructor(private readonly target: EventTarget) {
    const track = (event: Event, down: boolean): void => {
      const pointer = event as PointerEvent;
      const id = pointer.pointerId ?? 0;
      if (!down) this.active.delete(id);
      else
        (this.active.get(id) ?? this.active.set(id, new THREE.Vector2()).get(id))?.set(
          pointer.clientX ?? 0,
          pointer.clientY ?? 0,
        );
    };
    for (const [type, down] of [
      ["pointerdown", true],
      ["pointermove", null],
      ["pointerup", false],
      ["pointercancel", false],
    ] as const) {
      const listener = (event: Event): void =>
        track(event, down ?? this.active.has((event as PointerEvent).pointerId ?? 0));
      target.addEventListener(type, listener);
      this.#listeners.push([type, listener]);
    }
  }

  dispose(): void {
    for (const [type, listener] of this.#listeners)
      this.target.removeEventListener(type, listener);
    this.active.clear();
  }
}

export interface TouchInput {
  readonly jump: boolean;
  readonly dash: boolean;
  readonly x: number;
  readonly z: number;
}

const NO_TOUCH: TouchInput = { dash: false, jump: false, x: 0, z: 0 };

export class Hud {
  readonly group = new THREE.Group();
  #width = 1;
  #height = 1;
  readonly #hearts: THREE.Mesh[] = [];
  readonly #coins: Counter;
  readonly #gems: Counter;
  readonly #gemTotal: Counter;
  readonly #minutes: Counter;
  readonly #seconds: Counter;
  readonly #controls = new THREE.Group();
  readonly #stickBase: THREE.Mesh;
  readonly #stickKnob: THREE.Mesh;
  readonly #jumpButton: THREE.Mesh;
  readonly #dashButton: THREE.Mesh;
  readonly #jumpRing: THREE.Mesh;
  readonly #dashRing: THREE.Mesh;
  #stickCentre = new THREE.Vector2();
  #jumpCentre = new THREE.Vector2();
  #dashCentre = new THREE.Vector2();
  #stickRadius = 90;
  #buttonRadius = 62;
  #jumpWasDown = false;
  /** Where the current thumb landed. Undefined between touches. */
  #stickAnchor: { x: number; y: number } | undefined;

  constructor(private readonly camera: THREE.PerspectiveCamera) {
    this.group.renderOrder = 1000;
    this.group.frustumCulled = false;
    camera.add(this.group);

    const inkMaterial = flat(INK);
    const goldMaterial = flat(GOLD);
    const gemMaterial = flat(GEM_BLUE);

    // ---- top left: hearts and coins
    for (let index = 0; index < 3; index++) {
      const heart = new THREE.Mesh(HEART_GEOMETRY, flat(HEART_RED));
      heart.frustumCulled = false;
      heart.scale.setScalar(22);
      heart.position.set(40 + index * 52, 46, 0);
      this.group.add(heart);
      this.#hearts.push(heart);
    }

    const coin = disc(17, goldMaterial);
    coin.position.set(40, 108, 0);
    this.group.add(coin);
    const coinInner = disc(11, flat(GOLD_DARK));
    coinInner.position.set(40, 108, 1);
    this.group.add(coinInner);
    this.#coins = new Counter(3, 32, inkMaterial);
    this.#coins.group.position.set(66, 92, 0);
    this.group.add(this.#coins.group);

    // ---- top right: gems and the clock
    const gem = disc(15, gemMaterial, 6);
    gem.name = "gemIcon";
    this.group.add(gem);
    this.#gems = new Counter(1, 30, inkMaterial);
    this.#gemTotal = new Counter(1, 30, inkMaterial);
    const slash = quad(4, 30, inkMaterial);
    slash.rotation.z = 0.35;
    this.group.add(this.#gems.group, slash, this.#gemTotal.group);
    this.#gems.group.name = "gems";
    slash.name = "slash";
    this.#gemTotal.group.name = "gemTotal";

    this.#minutes = new Counter(2, 30, inkMaterial);
    this.#seconds = new Counter(2, 30, inkMaterial);
    const colon = new THREE.Group();
    for (const y of [-7, 7]) {
      const dot = quad(5, 5, inkMaterial);
      dot.position.y = y;
      colon.add(dot);
    }
    colon.name = "colon";
    this.group.add(this.#minutes.group, colon, this.#seconds.group);

    // ---- touch controls
    this.group.add(this.#controls);
    // White at a quarter opacity is invisible on this game's art. The scene is bright sky, bright
    // grass and pale stone almost everywhere the thumbs rest, so a white panel at 0.24 has nothing
    // to contrast against — the controls were drawing and working, and could not be seen. Each
    // control is now a dark shape carrying a light one, so it reads against light *and* dark, which
    // a single-tone overlay cannot do.
    const baseMaterial = flat(INK, 0.30);
    this.#stickBase = ring(this.#stickRadius, 14, baseMaterial);
    this.#stickKnob = disc(38, flat(PANEL, 0.85));
    this.#jumpButton = disc(this.#buttonRadius, flat(PANEL, 0.62));
    this.#dashButton = disc(this.#buttonRadius * 0.72, flat(PANEL, 0.52));
    // A dark ring behind each button, so the pale fill has an edge on a pale background.
    this.#jumpRing = ring(this.#buttonRadius, 9, flat(INK, 0.34));
    this.#dashRing = ring(this.#buttonRadius * 0.72, 8, flat(INK, 0.30));
    this.#controls.add(
      this.#stickBase,
      this.#jumpRing,
      this.#dashRing,
      this.#stickKnob,
      this.#jumpButton,
      this.#dashButton,
    );

    // One render order for the whole overlay, above anything the game draws.
    this.group.traverse((object) => {
      object.renderOrder = 1000;
      object.frustumCulled = false;
    });
    this.layout(1280, 720);
  }

  /** Re-anchors everything for a new canvas size and keeps the group one pixel per unit. */
  layout(width: number, height: number): void {
    this.#width = Math.max(1, width);
    this.#height = Math.max(1, height);
    const distance = 1;
    const halfHeight = Math.tan((this.camera.fov * Math.PI) / 360) * distance;
    const halfWidth = halfHeight * (this.#width / this.#height);
    const scale = (halfHeight * 2) / this.#height;
    this.group.position.set(-halfWidth, halfHeight, -distance);
    this.group.scale.set(scale, -scale, scale);

    const right = this.#width;
    this.group.getObjectByName("gemIcon")?.position.set(right - 186, 46, 0);
    this.group.getObjectByName("gems")?.position.set(right - 150, 30, 0);
    this.group.getObjectByName("slash")?.position.set(right - 122, 46, 0);
    this.group.getObjectByName("gemTotal")?.position.set(right - 108, 30, 0);
    this.#minutes.group.position.set(right - 190, 88, 0);
    this.group.getObjectByName("colon")?.position.set(right - 138, 104, 0);
    this.#seconds.group.position.set(right - 122, 88, 0);

    this.#stickRadius = Math.max(70, Math.min(120, this.#height * 0.17));
    this.#buttonRadius = this.#stickRadius * 0.68;
    this.#stickCentre.set(this.#stickRadius + 50, this.#height - this.#stickRadius - 50);
    this.#jumpCentre.set(
      this.#width - this.#buttonRadius - 60,
      this.#height - this.#buttonRadius - 60,
    );
    this.#dashCentre.set(
      this.#width - this.#buttonRadius * 2.9,
      this.#height - this.#buttonRadius * 0.9,
    );
    this.#stickBase.position.set(this.#stickCentre.x, this.#stickCentre.y, 0);
    this.#stickKnob.position.set(this.#stickCentre.x, this.#stickCentre.y, 1);
    this.#jumpButton.position.set(this.#jumpCentre.x, this.#jumpCentre.y, 0);
    this.#dashButton.position.set(this.#dashCentre.x, this.#dashCentre.y, 0);
    this.#jumpRing.position.set(this.#jumpCentre.x, this.#jumpCentre.y, 0);
    this.#dashRing.position.set(this.#dashCentre.x, this.#dashCentre.y, 0);
  }

  update(state: HudState): void {
    for (const [index, heart] of this.#hearts.entries())
      (heart.material as THREE.MeshBasicMaterial).color.setHex(
        index < state.hearts ? HEART_RED : HEART_EMPTY,
      );
    this.#coins.set(state.coins);
    this.#gems.set(state.gems);
    this.#gemTotal.set(state.gemTotal);
    this.#minutes.set(Math.floor(state.time / 60), true);
    this.#seconds.set(Math.floor(state.time % 60), true);
  }

  /**
   * Reads every finger currently down. Multiple pointers matter here: holding the stick and
   * pressing jump at the same time is two simultaneous pointers, which a single-pointer
   * reading cannot express.
   */
  readTouch(pointers: Iterable<THREE.Vector2>): TouchInput {
    const points = [...pointers];
    if (points.length === 0) {
      // Thumb lifted: the ring goes home and the next touch anchors wherever it lands.
      this.#stickAnchor = undefined;
      this.#stickBase.position.set(this.#stickCentre.x, this.#stickCentre.y, 0);
      this.#stickKnob.position.set(this.#stickCentre.x, this.#stickCentre.y, 1);
      this.#jumpWasDown = false;
      return NO_TOUCH;
    }
    let x = 0;
    let z = 0;
    let jumpHeld = false;
    let dash = false;
    let anchored: { x: number; y: number } | undefined;
    let drivingStick = false;
    let knobX = this.#stickCentre.x;
    let knobY = this.#stickCentre.y;

    for (const pointer of points) {
      const px = pointer.x;
      const py = pointer.y;
      if (Math.hypot(px - this.#jumpCentre.x, py - this.#jumpCentre.y) < this.#buttonRadius * 1.3) {
        jumpHeld = true;
        continue;
      }
      if (
        Math.hypot(px - this.#dashCentre.x, py - this.#dashCentre.y) <
        this.#buttonRadius * 1.05
      ) {
        dash = true;
        continue;
      }
      // Anything else on the left half drives the stick, so the thumb never has to find it.
      //
      // The stick anchors where the thumb lands. Measuring from the drawn circle instead made
      // the landing spot itself a full-strength direction: a thumb arriving mid-screen read as
      // hard right and slightly forward before it had moved at all, so pushing right went
      // diagonally and the control felt like it was fighting the player. Measured on a Pixel 8 —
      // a touch at (600,540) reported x=0.818, z=-0.576 with no drag at all.
      if (px < this.#width * 0.5) {
        drivingStick = true;
        this.#stickAnchor ??= { x: px, y: py };
        const dx = px - this.#stickAnchor.x;
        const dy = py - this.#stickAnchor.y;
        const distance = Math.min(Math.hypot(dx, dy), this.#stickRadius);
        const angle = Math.atan2(dy, dx);
        const strength = distance / this.#stickRadius;
        x = Math.cos(angle) * strength;
        z = Math.sin(angle) * strength;
        anchored = this.#stickAnchor;
        knobX = this.#stickAnchor.x + Math.cos(angle) * distance;
        knobY = this.#stickAnchor.y + Math.sin(angle) * distance;
      }
    }

    // Cleared per frame, not only when every finger lifts: a player holding jump while the moving
    // thumb comes off would otherwise keep the old anchor, and the next touch would measure from
    // wherever the previous one happened to start. That is the original bug wearing a hat.
    if (!drivingStick) this.#stickAnchor = undefined;
    // The ring travels to the anchor so the player can see where the stick actually is.
    const base = anchored ?? this.#stickCentre;
    this.#stickBase.position.set(base.x, base.y, 0);
    this.#stickKnob.position.set(knobX, knobY, 1);
    const jump = jumpHeld && !this.#jumpWasDown;
    this.#jumpWasDown = jumpHeld;
    return { dash, jump, x, z };
  }

  /** True while the jump button is held, for variable jump height. */
  get jumpHeld(): boolean {
    return this.#jumpWasDown;
  }

  dispose(): void {
    this.camera.remove(this.group);
  }
}
