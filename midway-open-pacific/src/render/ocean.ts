/** Camera-centred geometric waves, analytic normals and footprint-filtered ripples. */
import * as T from "three";

export const OCEAN_WAVES: [number, number, number, number, number][] = [
  [0.94, 0.34, 108, 1.15, 0.3],
  [0.76, 0.65, 61, 0.72, 0.27],
  [-0.61, 0.79, 87, 0.68, 0.23],
  [0.4, -0.92, 45, 0.31, 0.2],
  [0.42, 0.91, 34, 0.38, 0.23],
  [-0.35, 0.94, 18, 0.19, 0.19],
  [0.99, -0.12, 9.4, 0.08, 0.15],
  [0.7, 0.71, 4.8, 0.035, 0.13],
];

export function waveHeight(x: number, z: number, time: number): number {
  let y = 0;
  for (const [dx, dz, L, A] of OCEAN_WAVES) {
    const l = Math.hypot(dx, dz);
    const k = (2 * Math.PI) / L;
    const warp = ((k * (-x * dz + z * dx)) / l) * 0.22 - time * 0.07;
    y += A * Math.sin((k * (x * dx + z * dz)) / l - Math.sqrt(9.81 * k) * time + 0.85 * Math.sin(warp));
  }
  return y;
}

const waveGLSL = OCEAN_WAVES.map(
  (w) => `wave(vec2(${w[0].toFixed(4)},${w[1].toFixed(4)}),${w[2].toFixed(3)},${w[3].toFixed(4)},${w[4].toFixed(3)},world,disp,dx,dz,crest,unresolved);`,
).join("\n");

const shared = `
 uniform float uTime; uniform vec3 uSun;
 void wave(vec2 dir,float lengthW,float amp,float steep,vec2 p,inout vec3 dis,inout vec3 dx,inout vec3 dz,inout float crest,inout float unresolved){
  dir=normalize(dir);float k=6.2831853/lengthW;vec2 perpendicular=vec2(-dir.y,dir.x);
  float warp=k*dot(perpendicular,p)*.22-uTime*.07;
  float phase=k*dot(dir,p)-sqrt(9.81*k)*uTime+.85*sin(warp);
  vec2 gradient=k*(dir+perpendicular*.187*cos(warp));
  float filterW=1.;
  #ifdef FILTER_WAVES
   float footprintW=max(abs(dot(dFdx(p),gradient)),abs(dot(dFdy(p),gradient)))/k;
   filterW=exp(-.5*pow(footprintW*k*1.35,2.));
  #endif
  unresolved+=pow(amp*k,2.)*(1.-filterW)*.5;
  float sn=sin(phase),cs=cos(phase),qa=amp*steep;
  amp*=filterW;qa*=filterW;
  dis+=vec3(qa*dir.x*cs,amp*sn,qa*dir.y*cs);
  dx+=vec3(-qa*dir.x*gradient.x*sn,amp*gradient.x*cs,-qa*dir.y*gradient.x*sn);
  dz+=vec3(-qa*dir.x*gradient.y*sn,amp*gradient.y*cs,-qa*dir.y*gradient.y*sn);
  crest+=max(sn-.6,0.)*amp*.32;
 }
 vec3 skyColor(vec3 d){
  float h=max(0.,d.y);vec3 col=mix(vec3(.32,.47,.56),vec3(.065,.20,.34),pow(h,.42));
  col+=vec3(.49,.26,.105)*pow(max(0.,dot(d,uSun)),8.)*.6;
  return col;
 }
 float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
 float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.)),f.x),f.y);}
`;

export interface IOceanSurface {
  mesh: T.Mesh;
  material: T.ShaderMaterial;
  update(camera: { x: number; z: number }, time: number, ships: any[]): void;
}

export function makeOceanSurface(sunDirection: T.Vector3): IOceanSurface {
  // Log-spaced concentric rings: fine near the aircraft, enormous far horizon.
  const segments = 224;
  const rings = 156;
  const positions: number[] = [0, 0, 0];
  const indices: number[] = [];
  const maxR = 100000;
  const nearStep = 1.6;
  const growth = Math.log(1 + maxR / nearStep) / rings;
  for (let r = 0; r < rings; r += 1) {
    const radius = nearStep * (Math.exp((r + 1) * growth) - 1);
    for (let j = 0; j < segments; j += 1) {
      const a = (j / segments) * Math.PI * 2;
      positions.push(Math.cos(a) * radius, 0, Math.sin(a) * radius);
    }
  }
  for (let j = 0; j < segments; j += 1) indices.push(0, 1 + ((j + 1) % segments), 1 + j);
  for (let r = 1; r < rings; r += 1)
    for (let j = 0; j < segments; j += 1) {
      const a = 1 + (r - 1) * segments + j;
      const b = 1 + (r - 1) * segments + ((j + 1) % segments);
      const c = 1 + r * segments + j;
      const d = 1 + r * segments + ((j + 1) % segments);
      indices.push(a, d, c, a, b, d);
    }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const ships = Array.from({ length: 20 }, () => new T.Vector4(1e8, 1e8, 0, 0));
  const shipParams = Array.from({ length: 20 }, () => new T.Vector4());
  const uniforms = {
    uTime: { value: 0 },
    uSun: { value: sunDirection },
    uOrigin: { value: new T.Vector2() },
    uShips: { value: ships },
    uShipParams: { value: shipParams },
    uQuality: { value: 1 },
  };
  const material = new T.ShaderMaterial({
    uniforms,
    side: T.FrontSide,
    vertexShader: `
 ${shared}
 uniform vec2 uOrigin;varying vec3 vWorld;varying vec3 vNormal;varying vec2 vSample;varying float vCrest;
 void main(){vec2 world=position.xz+uOrigin;vec3 disp=vec3(0.),dx=vec3(1.,0.,0.),dz=vec3(0.,0.,1.);float crest=0.,unresolved=0.;${waveGLSL}
 vSample=world;vWorld=vec3(world.x,0.,world.y)+disp;vNormal=normalize(cross(dz,dx));vCrest=crest;
 gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);}
 `,
    fragmentShader: `
 #define FILTER_WAVES
 ${shared}
 uniform vec4 uShips[20];uniform vec4 uShipParams[20];uniform float uQuality;
 varying vec3 vWorld;varying vec3 vNormal;varying vec2 vSample;varying float vCrest;
 void main(){
  vec3 view=normalize(cameraPosition-vWorld);float distanceW=length(cameraPosition-vWorld);
  vec2 world=vSample;vec3 disp=vec3(0.),dx=vec3(1.,0.,0.),dz=vec3(0.,0.,1.);float crest=0.,unresolved=0.;${waveGLSL}
  vec3 normal=normalize(cross(dz,dx));
  float footprint=max(length(dFdx(world)),length(dFdy(world)));
  vec2 slope=vec2(0.);float frequency=1.35,amplitude=.047;
  vec2 dir=normalize(vec2(.92,.39));float variance=unresolved;
  for(int i=0;i<6;i++){
   float fade=1.-smoothstep(.35,2.4,footprint*frequency);float phase=dot(world,dir)*frequency-uTime*sqrt(9.81*frequency);
   float warp=noise(world*.031+float(i)*7.1)*3.;slope+=dir*cos(phase+warp)*amplitude*fade;
   variance+=amplitude*amplitude*(1.-fade);dir=vec2(dir.x*.62-dir.y*.785,dir.x*.785+dir.y*.62);frequency*=1.94;amplitude*=.66;
  }
  normal=normalize(normal+vec3(-slope.x,0.,-slope.y));
  float nv=max(.001,dot(normal,view));float fresnel=.02037+.97963*pow(1.-nv,5.);
  vec3 reflection=reflect(-view,normal),sky=skyColor(reflection);
  float facing=clamp(dot(normal,uSun)*.5+.5,0.,1.);
  vec3 deep=vec3(.007,.056,.090),shallow=vec3(.012,.18,.215);
  float scatter=pow(max(0.,dot(view,-uSun)),3.)*max(0.,disp.y+1.)*.14;
  vec3 body=mix(deep,shallow,.10+facing*.14+scatter);
  vec3 color=mix(body,sky,fresnel);
  vec3 halfV=normalize(view+uSun);float nh=max(.0,dot(normal,halfV)),nl=max(.001,dot(normal,uSun));
  float pixelVariance=max(dot(dFdx(normal),dFdx(normal)),dot(dFdy(normal),dFdy(normal)));
  float roughness=clamp(sqrt(.14*.14+variance*3.+pixelVariance*1.8),.14,.48);float a2=pow(roughness,4.);
  float D=a2/(3.14159*pow(nh*nh*(a2-1.)+1.,2.)+.0000002);
  float G=nv/(nv*(1.-roughness)+roughness)*nl/(nl*(1.-roughness)+roughness);
  float spec=min(14.,D*G*fresnel/(4.*nv*nl+.001))*nl;
  color+=vec3(1.45,1.04,.65)*spec;
  float n1=noise(world*.48+vec2(-uTime*.08,uTime*.04));
  float foam=smoothstep(.34,.52,crest)*smoothstep(.55,.77,n1)*.14*(1.-smoothstep(4.,22.,footprint));
  for(int i=0;i<20;i++){
   vec4 s=uShips[i];vec4 params=uShipParams[i];vec2 rel=world-s.xy;
   if(abs(rel.x)<1000.&&abs(rel.y)<1000.&&params.z>.0){
    float right=rel.x*cos(s.z)+rel.y*sin(s.z),along=rel.x*sin(s.z)-rel.y*cos(s.z);
    float aft=-along-s.w*.41,width=params.x;
    if(aft>0.&&aft<760.){
     float fade=(1.-smoothstep(20.,760.,aft))*params.z;
     float vEdge=abs(abs(right)-(.34*aft+width*.25));
     float wake=exp(-vEdge*vEdge/(4.+aft*.044))*fade;
     float wash=exp(-right*right/(width*width*.2+aft*2.))*exp(-aft/260.)*fade;
     float churn=.38+.62*noise(world*.24+vec2(uTime*.5,-uTime*.7));
     foam+=wake*churn*.42+wash*churn*.45;
    }
    float bow=length(vec2(right*.65,along-s.w*.43));foam+=exp(-bow*bow/(width*1.8))*.45*params.z;
   }
  }
  foam=clamp(foam,0.,.72);color=mix(color,vec3(.52,.65,.66),foam);
  float fog=1.-exp(-distanceW*.000012);color=mix(color,skyColor(normalize(vec3(view.x,.015,view.z))),fog);
  gl_FragColor=vec4(color,1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
 }
 `,
  });
  const mesh = new T.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -2;
  return {
    material,
    mesh,
    update(camera, time, shipList) {
      uniforms.uTime.value = time;
      uniforms.uOrigin.value.set(camera.x, camera.z);
      for (let i = 0; i < 20; i += 1) {
        const s = shipList[i];
        if (s && !s.sunk && (s.kind !== "sub" || s.surfaced)) {
          uniforms.uShips.value[i].set(s.x, s.z, s.heading, s.length);
          uniforms.uShipParams.value[i].set(s.width, s.speed, Math.min(1, s.speed / 8), 0);
        } else uniforms.uShipParams.value[i].z = 0;
      }
    },
  };
}
