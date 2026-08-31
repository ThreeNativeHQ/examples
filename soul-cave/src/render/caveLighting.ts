// Ordinary Three.js: the framework decides none of this.
//
// The reference is one hard shaft of daylight falling through a hole in the ceiling into a room
// that is otherwise almost black, with the rock nearest the shaft picking up a warm bounce. That
// is three decisions: a single strong shadow-casting directional light, an ambient term low
// enough that the foreground reads as silhouette, and a warm bounce colour that screen-space GI
// can spread onto the walls.
import {
  DoubleSide,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  PCFSoftShadowMap,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PointLight,
  type Scene,
} from "three";

/** Only the two fields this file sets; the renderer type itself belongs to the framework. */
type ShadowRenderer = { shadowMap: { enabled: boolean; type: number } };

/** Daylight through the ceiling gap: white-warm, and the only thing casting a shadow. */
const SUN_COLOUR = 0xfff1d8;
const SUN_INTENSITY = 9.0;
/** Sky above the gap against damp rock below — the ambient the shaft is read against. */
const SKY_COLOUR = 0x3a4b63;
const GROUND_COLOUR = 0x2a1d12;
const AMBIENT_INTENSITY = 1.5;
/** The warm kick on rock next to the shaft, standing in for the first bounce. */
const BOUNCE_COLOUR = 0xffb066;

export interface ICaveLighting {
  readonly sun: DirectionalLight;
  /** The blown-out opening the shaft comes through, so the light has a visible source. */
  readonly opening: Mesh;
}

export function setupCaveLighting(scene: Scene, renderer: ShadowRenderer): ICaveLighting {
  // Without this no shadow map is ever allocated, and the godrays stage — which raymarches
  // against exactly that map — refuses to build. The whole post chain then silently stays off.
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;

  scene.background = new Color(0x05070b);
  // Thick enough that the far pillars fall away into the dark, thin enough that the shaft still
  // reaches the floor. The godrays stage raymarches against the same volume.
  scene.fog = new FogExp2(0x0b0906, 0.0010);

  const sun = new DirectionalLight(SUN_COLOUR, SUN_INTENSITY);
  // High and behind the far pillars, angled to land the shaft on the floor in front of camera.
  sun.position.set(8, 46, -16);
  sun.target.position.set(-1, 0, -31);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.05;
  // The chamber is roughly 90 m across; a default 10 m frustum would shadow nothing.
  const shadowCamera = sun.shadow.camera;
  shadowCamera.left = -55;
  shadowCamera.right = 55;
  shadowCamera.top = 55;
  shadowCamera.bottom = -55;
  shadowCamera.near = 1;
  shadowCamera.far = 140;
  shadowCamera.updateProjectionMatrix();
  scene.add(sun, sun.target);

  scene.add(new HemisphereLight(SKY_COLOUR, GROUND_COLOUR, AMBIENT_INTENSITY));

  // Two unshadowed warm fills where the shaft meets rock. Cheap, and they give the screen-space
  // GI something warm to gather; without them the walls stay the colour of the ambient alone.
  const bounce = new PointLight(BOUNCE_COLOUR, 140, 44, 2);
  bounce.position.set(-1, 2, -31);
  scene.add(bounce);

  const farBounce = new PointLight(BOUNCE_COLOUR, 70, 38, 2);
  farBounce.position.set(0, 11, -28);
  scene.add(farBounce);

  // The reference's shaft ends in a hole full of white sky. Without something bright behind the
  // far pillars the godrays start from nowhere, which reads as haze rather than as daylight.
  const opening = new Mesh(
    new PlaneGeometry(15.2, 11.2),
    new MeshBasicMaterial({ color: 0xfff4e2, fog: false, side: DoubleSide, toneMapped: false }),
  );
  opening.position.set(2, 19.3, -24);
  opening.rotation.x = Math.PI / 2;
  opening.name = "caveOpening";
  scene.add(opening);

  // A third fill on the near rock. The reference's foreground is dark but never featureless: the
  // shaft lights the floor, and the floor lights everything around it.
  const nearBounce = new PointLight(BOUNCE_COLOUR, 34, 26, 2);
  nearBounce.position.set(0, 3, -14);
  scene.add(nearBounce);

  // The second opening over the left aisle, and the daylight falling through it.
  const sideOpening = new Mesh(
    new PlaneGeometry(8.2, 6.2),
    new MeshBasicMaterial({ color: 0xfff4e2, fog: false, side: DoubleSide, toneMapped: false }),
  );
  sideOpening.position.set(-21, 19.3, -13);
  sideOpening.rotation.x = Math.PI / 2;
  sideOpening.name = "caveSideOpening";
  scene.add(sideOpening);

  const sideShaft = new PointLight(0xd8e2f0, 60, 34, 2);
  sideShaft.position.set(-21, 9, -13);
  scene.add(sideShaft);

  return { sun, opening };
}
