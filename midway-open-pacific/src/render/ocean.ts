/** Reference Pacific swells, evaluated by the engine's analytic WaveField on a dense near grid. */
import { reflectedSky, SUN_DIRECTION } from "./environment.js";
import { WaveField, WaterSurface3D } from "@threenative/core";
import { BufferGeometry, Float32BufferAttribute, Mesh, Vector2, Vector4, DoubleSide, DataTexture, RepeatWrapping, LinearFilter, LinearMipmapLinearFilter } from "three";
import {
  Fn, If, cameraPosition, dot, float, mix, mx_noise_float, mx_worley_noise_vec2, positionGeometry, texture, vec2,
  smoothstep, uniform, uniformArray, varying, vec3,
} from "three/tsl";
import { MeshBasicNodeMaterial, type Node } from "three/webgpu";

/** The reference's swell spectrum; CPU and shader sample this exact same field. */
/**
 * The layer the water's reflection draws. An object on it is **also** on layer 0, so the main camera
 * is unaffected and only the mirrored pass narrows.
 */
export const REFLECTED_LAYER = 1;

export const OCEAN_BANDS = [[.54,.035,.014,.56],[.28,-.057,.041,.83],[.12,.13,.09,1.25],[.055,-.27,.18,1.74]];
const SEA = .65;
/** Past this many metres the sea is sky and haze, not a mirror, so the viewport reads stop paying. */
const FAR_RANGE = 8000;
const swell = new WaveField({waves:OCEAN_BANDS.map(([a,kx,kz,w])=>({direction:{x:kx,z:kz},
  wavelength:2*Math.PI/Math.hypot(kx,kz),amplitude:a*SEA,speed:w,detail:true}))});
export const oceanSwell = (x:number,z:number,time:number) => swell.sample(x,z,time).height;
export const oceanSwellNode = (point:any,time:any):any => swell.heightNode({point,time});

/** Periodic height noise; both slopes derive from one surface. Adapted from Fluid Lab V2 (MIT). */
function normalTexture(){
  const n=256,data=new Uint8Array(n*n*4);
  const hash=(x:number,z:number)=>{const a=Math.sin(x*127.1+z*311.7)*43758.5453;return a-Math.floor(a);};
  const noise=(u:number,v:number,k:number)=>{const x=u*k,z=v*k,i=Math.floor(x),j=Math.floor(z);let a=x-i,b=z-j;
    a=a*a*a*(a*(a*6-15)+10);b=b*b*b*(b*(b*6-15)+10);
    const h=(x:number,z:number)=>hash((x%k+k)%k,(z%k+k)%k);
    return (h(i,j)*(1-a)+h(i+1,j)*a)*(1-b)+(h(i,j+1)*(1-a)+h(i+1,j+1)*a)*b;};
  const height=(u:number,v:number)=>noise(u,v,8)*.58+noise(u,v,16)*.28+noise(u,v,32)*.11+noise(u,v,64)*.03;
  for(let j=0;j<n;j++)for(let i=0;i<n;i++){
    const u=i/n,v=j/n,e=1/n,nx=(height(u+e,v)-height(u-e,v))*6,nz=(height(u,v+e)-height(u,v-e))*6,k=(j*n+i)*4;
    data[k]=Math.max(0,Math.min(255,(nx*.5+.5)*255));data[k+1]=Math.max(0,Math.min(255,(nz*.5+.5)*255));data[k+2]=240;data[k+3]=height(u,v)*255;
  }
  const t=new DataTexture(data,n,n);t.wrapS=t.wrapT=RepeatWrapping;t.magFilter=LinearFilter;t.minFilter=LinearMipmapLinearFilter;t.generateMipmaps=true;t.needsUpdate=true;return t;
}

export function createOcean({rippleHeight,rippleNormal,rippleFoam,rippleFlow}: {
  rippleHeight?: (point:any)=>any; rippleNormal?: (point:any)=>any; rippleFoam?: (point:any)=>any; rippleFlow?: (point:any)=>any;
}={}) {
  const origin=uniform(new Vector2()),time=uniform(0),sun=vec3(SUN_DIRECTION);
  const ships=Array.from({length:20},()=>new Vector4(1e8,1e8,0,0));
  const sizes=Array.from({length:20},()=>new Vector4());
  const shipNodes=uniformArray<"vec4">(ships,"vec4"),sizeNodes=uniformArray<"vec4">(sizes,"vec4");
  const normalMap=normalTexture();
  // The mirrored pass is a second draw of the world, and on this scene it is a draw-call bill, not
  // a pixel one: at 68 airborne aircraft it submitted 911 of the frame's 1,965 calls and cost 10 ms
  // on the one frame in five it ran, which is the whole of the AC-23 gap. Halving its resolution
  // again moved GPU p95 by 0.22 ms, because pixels were never what it was spending. So it is told
  // what to draw instead: the hulls and the atoll — the silhouettes a player actually reads in the
  // water — and not sixty-eight aircraft that are a few pixels each in the mirror and half of them
  // behind the camera. `markReflected` is the other half of this, in src/render/world.ts.
  const surface=new WaterSurface3D({level:0,maxThickness:14,reflection:{resolutionScale:.5,layers:1<<REFLECTED_LAYER}});

  // Logarithmic rings keep metre-scale triangles beside the carrier and reach the horizon.
  // Ring count sets how finely the swell is sampled at range, and the ships sit at range: at
  // 156 rings the spacing out at 300m was 21m, so a 45m wave got two vertices and the sea
  // flattened into ripples exactly where a destroyer is being looked at. Doubling the rings
  // halves that spacing and costs only vertices, not another wave evaluation per pixel.
  const segments = 320, rings = 360, positions = [0, 0, 0], indices: number[] = [];
  const growth = Math.log(1 + 100000 / 1.6) / rings;
  for (let r = 0; r < rings; r++) {
    const radius = 1.6 * (Math.exp((r + 1) * growth) - 1);
    for (let j = 0; j < segments; j++) {
      const a = j / segments * Math.PI * 2;
      positions.push(Math.cos(a) * radius, 0, Math.sin(a) * radius);
    }
  }
  for (let j = 0; j < segments; j++) indices.push(0, 1 + (j + 1) % segments, 1 + j);
  for (let r = 1; r < rings; r++) for (let j = 0; j < segments; j++) {
    const a = 1 + (r - 1) * segments + j, b = 1 + (r - 1) * segments + (j + 1) % segments;
    const c = 1 + r * segments + j, d = 1 + r * segments + (j + 1) % segments;
    indices.push(a, d, c, a, b, d);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const material = new MeshBasicNodeMaterial({ fog: false, transparent: true, depthWrite: true, side: DoubleSide });
  const point = positionGeometry.xz.add(origin);
  const height = Fn(() => {
    const h = float(0).toVar();
    h.addAssign(oceanSwellNode(point,time));
    if (rippleHeight) h.addAssign(rippleHeight(point));
    return h;
  })();
  material.positionNode = vec3(positionGeometry.x, height, positionGeometry.z);
  const world = varying(point);
  const worldHeight = varying(height);
  material.colorNode = Fn(() => {
    const footprint = world.dFdx().length().max(world.dFdy().length()).toVar();
    const worldPos=vec3(world.x,worldHeight,world.y);
    const distance=cameraPosition.sub(worldPos).length();
    const analytic:any=swell.normalNode({point:world,time});
    const impact:any=rippleNormal?rippleNormal(world):vec2(0);
    const detail=float(1).div(distance.mul(.003).add(1)).mul(smoothstep(.4,4,footprint).oneMinus());
    // Both octaves reach the normal only through `detail`, so below 0.02 they are multiplied to a
    // normal shift of at most ~0.01: two texture fetches bought for something no pixel can show.
    const ripple=vec2(0,0).toVar();
    If(detail.greaterThan(.02), () => {
      const micro=texture(normalMap,world.mul(vec2(.022,.045)).add(vec2(time.mul(.006),time.mul(.003))));
      const finer=texture(normalMap,world.mul(vec2(.10,.075)).add(vec2(time.mul(-.014),time.mul(.009))));
      ripple.assign(micro.rg.mul(2).sub(1).add(finer.rg.mul(2).sub(1).mul(.32)));
    });
    const normal=vec3(analytic.x.div(analytic.y).sub(impact.x).add(ripple.x.mul(.47).mul(detail)),
      1,analytic.z.div(analytic.y).sub(impact.y).add(ripple.y.mul(.47).mul(detail))).normalize().toVar();
    const view = cameraPosition.sub(vec3(world.x, worldHeight, world.y)).normalize().toVar();
    const nv = dot(normal, view).max(.001);
    const fresnel = nv.oneMinus().pow(5).mul(.97963).add(.02037);
    // One prefiltered sky lookup now serves both the mirror term and the haze term. Past a few
    // kilometres the sea reflects that same sky it dissolves into, so the half-res mirror read
    // stops buying a distinct image; the background and this lookup share the same 0.65 intensity.
    const sky=reflectedSky(vec3(view.x,.015,view.z).normalize());
    const body = vec3(.005,.030,.048).add(vec3(.004,.020,.022).mul(worldHeight.max(0)))
      .add(vec3(.014,.066,.071).mul(rippleFoam?rippleFoam(world).mul(1.6).min(1):float(0)));
    const nh = dot(normal, view.add(sun).normalize()).max(0);
    const nl = dot(normal, sun).max(.001);
    const pixelVariance = dot(normal.dFdx(), normal.dFdx()).max(dot(normal.dFdy(), normal.dFdy()));
    const roughness = pixelVariance.mul(1.8).add(.075 ** 2).sqrt().clamp(.075, .35);
    const offset=normal.xz.mul(.017).mul(detail);
    // Near water keeps the sharp, offset mirror. Far water uses the sky lookup above and skips the
    // half-res reflection read entirely.
    const mirror=sky.toVar();
    If(distance.lessThan(FAR_RANGE), () => mirror.assign(surface.reflectionAt(offset)));
    // Beyond FAR_RANGE the seabed is more than the 14 m clamp behind every fragment a pixel wide,
    // so thickness is its maximum there and the depth read (and, below, refraction) is dead weight.
    const thickness=float(14).toVar();
    If(distance.lessThan(FAR_RANGE), () => thickness.assign(surface.thicknessAt()));
    const transmission=thickness.div(4).oneMinus().max(0).pow(2);
    // Refraction only contributes where transmission is non-zero, which is water shallower than 4 m.
    // Over the deep open sea it is multiplied by zero after the read, so skip the read itself.
    const beneath=vec3(0,0,0).toVar();
    If(transmission.greaterThan(0), () => beneath.assign(surface.refractionAt(normal.xz.mul(.008)).mul(transmission)));
    const water=body.mul(transmission.oneMinus()).add(beneath.mul(vec3(.45,.72,.76)));
    const result = mix(water, mirror, fresnel.mul(.91).add(.065).clamp(0,.96)).toVar();
    const a2 = roughness.pow(4);
    const distribution = a2.div(nh.pow(2).mul(a2.sub(1)).add(1).pow(2).mul(Math.PI).add(.0000002));
    const masking = nv.div(nv.mul(roughness.oneMinus()).add(roughness)).mul(nl.div(nl.mul(roughness.oneMinus()).add(roughness)));
    const spec = distribution.mul(masking).mul(fresnel).div(nv.mul(nl).mul(4).add(.001)).min(14).mul(nl);
    result.addAssign(vec3(1.45, 1.04, .65).mul(spec));
    const noise = mx_noise_float(world.mul(.48).add(time.mul(.04))).mul(.5).add(.5);
    const foam = float(0).toVar();
    for (let i = 0; i < ships.length; i++) {
      const s = shipNodes.element(i), size = sizeNodes.element(i);
      const rel = world.sub(s.xy);
      const right = rel.x.mul(s.z.cos()).add(rel.y.mul(s.z.sin()));
      const along = rel.x.mul(s.z.sin()).sub(rel.y.mul(s.z.cos()));
      const aft = along.negate().sub(s.w.mul(.41));
      const fade = smoothstep(0, 20, aft).mul(smoothstep(20, 760, aft).oneMinus()).mul(size.z);
      const edge = right.abs().sub(aft.mul(.34).add(size.x.mul(.25)));
      const wake = edge.pow(2).negate().div(aft.max(0).mul(.044).add(4)).exp().mul(fade);
      const wash = right.pow(2).negate().div(size.x.pow(2).mul(.2).add(aft.max(0).mul(2)).max(1)).exp().mul(aft.max(0).div(-260).exp()).mul(fade);
      // The hull pushes water aside along its whole waterline, hardest at the bow. Without this
      // a ship has a wake trailing behind it but never disturbs the sea it is sitting in, and
      // reads as a cutout laid on the surface rather than a hull in the water.
      const alongHull = along.div(s.w.max(1));
      const amidships = float(.5).sub(alongHull.abs()).max(0);
      const outboard = right.abs().sub(size.x.mul(.5)).max(0);
      const bowBias = smoothstep(-.12, .46, alongHull).mul(.75).add(.5);
      const hullWash = smoothstep(0, .1, amidships)
        .mul(outboard.mul(-.5).exp())
        .mul(size.z)
        .mul(bowBias);
      foam.addAssign(
        wake.mul(.55).add(wash.mul(.4)).add(hullWash.mul(.28)).mul(noise.mul(.62).add(.38)),
      );
    }
    if (rippleFoam) foam.addAssign(rippleFoam(world));
    // The density moves with the solver. Noise reveals rounded pores instead of painting a white disc.
    const flow=rippleFlow?rippleFlow(world):vec2(0);
    const coord=world.sub(vec2(.22,.06).mul(time)).sub(flow.mul(time).mul(.055));
    const breakup=mx_noise_float(coord.mul(.26)).mul(.31).add(mx_noise_float(coord.mul(.79)).mul(.13))
      .add(mx_noise_float(coord.mul(2.6)).mul(.06)).add(.5);
    const coverage=smoothstep(.22,.62,foam.mul(1.15).add(breakup.mul(.37)));
    const grain=mx_noise_float(coord.mul(4.4)).mul(.5).add(.5);
    const warp=vec2(mx_noise_float(coord.mul(.19)),mx_noise_float(coord.mul(.19).add(12))).mul(2.4);
    const cell=mx_worley_noise_vec2(coord.mul(2.4).add(warp),float(1));
    const pore=smoothstep(.11,.33,cell.x).oneMinus().mul(smoothstep(.20,.53,mx_noise_float(coord.mul(3.3)).mul(.5).add(.5)));
    const rim=smoothstep(.10,.23,cell.x).mul(smoothstep(.23,.34,cell.x).oneMinus());
    const froth=mix(vec3(.32,.45,.46),vec3(.69,.78,.78),grain.mul(.85).add(rim.mul(.2)).clamp());
    result.assign(mix(result,froth,coverage.mul(pore.mul(.88).oneMinus()).mul(.96)));
    const haze=sky;
    const above=mix(result,haze,distance.mul(-.00006).exp().oneMinus());
    return cameraPosition.y.lessThan(0).select(vec3(.02,.17,.20).add(above.mul(.38)),above);
  })();
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -2;
  mesh.name = "sea-surface";
  return {
    mesh,
    dispose:()=>{surface.dispose();normalMap.dispose();geometry.dispose();material.dispose();},
    update(camera: { x: number; z: number }, elapsed: number, vessels: Array<{ x: number; z: number; heading: number; hullLength: number; hullBeam: number; speed: number; sunk: boolean; kind: string; surfaced?: boolean }>) {
      time.value = elapsed;
      origin.value.set(camera.x, camera.z);
      mesh.position.set(camera.x, 0, camera.z);
      const visible=vessels.filter(s=>!s.sunk&&(s.kind!=="sub"||s.surfaced))
        .sort((a,b)=>(a.x-camera.x)**2+(a.z-camera.z)**2-((b.x-camera.x)**2+(b.z-camera.z)**2));
      for (let i = 0; i < ships.length; i++) {
        const s = visible[i];
        if (s && !s.sunk && (s.kind !== "sub" || s.surfaced)) {
          ships[i].set(s.x, s.z, s.heading, s.hullLength);
          sizes[i].set(s.hullBeam, s.speed, Math.min(1, s.speed / 8), 0);
        } else sizes[i].z = 0;
      }
    },
  };
}
