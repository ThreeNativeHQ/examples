/** One local free surface drives ocean shading, whitewater collisions, and floating foam. */
import { RippleField } from "@threenative/core";
import { ClampToEdgeWrapping, DataTexture, DataUtils, HalfFloatType, LinearFilter, RGBAFormat, Vector2 } from "three";
import { float, smoothstep, texture, uniform, vec2 } from "three/tsl";
import { createHullQuery } from "./hull-query.js";
import { WaterEffects } from "./water-effects.js";
import { oceanSwell, oceanSwellNode } from "./ocean.js";

export function createRipples() {
  const field = new RippleField({resolution:192,size:640,speed:22,damping:.27,foamHalfLife:7,current:{x:.22,z:.06},step:1/120,maxSteps:24});
  const n=field.resolution,data=new Uint16Array(n*n*4);
  const map=new DataTexture(data,n,n,RGBAFormat,HalfFloatType);
  map.minFilter=map.magFilter=LinearFilter;map.wrapS=map.wrapT=ClampToEdgeWrapping;map.needsUpdate=true;
  const center=uniform(new Vector2()),time=uniform(0);
  // Cell centres, not cell edges: CPU sampling and vertex/fragment sampling agree.
  const uvAt=(p:any):any=>p.sub(center).div(field.size).add(.5);
  const rim=(uv:any):any=>smoothstep(0,.07,uv.x).mul(smoothstep(0,.07,uv.x.oneMinus()))
    .mul(smoothstep(0,.07,uv.y)).mul(smoothstep(0,.07,uv.y.oneMinus()));
  const read=(p:any):any=>{const uv=uvAt(p);return texture(map,uv.mul((n-1)/n).add(.5/n)).level(float(0)).mul(rim(uv));};
  const heightNode=(p:any):any=>read(p).r;
  const normalNode=(p:any):any=>vec2(heightNode(p.add(vec2(field.dx,0))).sub(heightNode(p.sub(vec2(field.dx,0)))),
    heightNode(p.add(vec2(0,field.dx))).sub(heightNode(p.sub(vec2(0,field.dx))))).div(2*field.dx);
  const surfaceNode=(p:any):any=>oceanSwellNode(p,time).add(heightNode(p));
  const rimCPU=(x:number,z:number)=>{
    const sx=(v:number)=>{const t=Math.min(1,Math.max(0,v/.07));return t*t*(3-2*t);};
    const u=(x-field.centerX)/field.size+.5,v=(z-field.centerZ)/field.size+.5;
    return sx(u)*sx(1-u)*sx(v)*sx(1-v);
  };
  const heightAt=(x:number,z:number,t:number)=>oceanSwell(x,z,t)+field.heightAt(x,z)*rimCPU(x,z);
  const {cache:cacheHulls,heightAt:hullHeightAt}=createHullQuery();
  // 147,456 half-float conversions, and the trace was paying them on every update whether the
  // solver had changed a cell or not — and on updates that never reached a render at all. Pack on
  // the field's own version instead, from the material's render update, so the bytes uploaded are
  // the latest ones and each version is converted once however many passes read the texture.
  let lastPackedVersion=-1;
  const syncTexture=()=>{
    if(field.version===lastPackedVersion)return;
    lastPackedVersion=field.version;
    // Read the arrays off the field now: the solver swaps `height` and `foam` with its scratch
    // buffers every step, so a reference captured earlier packs the previous step's grid.
    const h=field.height,f=field.foam,fx=field.flowX,fz=field.flowZ;
    for(let i=0;i<n*n;i++){data[i*4]=DataUtils.toHalfFloat(h[i]!);data[i*4+1]=DataUtils.toHalfFloat(f[i]!);
      data[i*4+2]=DataUtils.toHalfFloat(fx[i]!);data[i*4+3]=DataUtils.toHalfFloat(fz[i]!);}
    map.needsUpdate=true;
  };
  // The centre uniform is read by every ripple texture lookup, so the first material that actually
  // draws water runs this before its bindings are uploaded. A scene-level `onBeforeRender` would
  // work too and would cost the saving: engine `projection-plan.ts` treats an owned object render
  // hook as a reason to switch scene projection off. The callback returns nothing and the uniform
  // keeps its value; repeated reflection and shadow passes are free because of the version guard.
  center.onRenderUpdate(()=>{syncTexture();});
  let simulationOffset=0;
  const effects=new WaterEffects(field,(x,z,t)=>heightAt(x,z,t+simulationOffset),hullHeightAt,surfaceNode);
  let seen=new Set<string>(),lastBattleTime=0,elapsed=0;
  const update=(battle:any,camera:{x:number;z:number},dt:number)=>{
    cacheHulls(battle.ships);
    effects.whitewater.wind.x=battle.wind.x;effects.whitewater.wind.z=battle.wind.z;
    // Stop with the battle clock (including pause and debrief); no duplicate wall-time clock.
    const delta=Math.max(0,Math.min(.2,battle.time-lastBattleTime));lastBattleTime=battle.time;
    elapsed=battle.time;time.value=elapsed;
    const incoming=battle.effects.filter((e:any)=>!seen.has(e.id)&& (e.type==='splash'||e.waterKind));
    // Nearest live impact keeps the field centred on it while the aircraft flies past.
    let nearest:any=null,nearestDist=Infinity;
    for(const e of incoming){const d=Math.hypot(e.x-camera.x,e.z-camera.z);if(d<1800&&d<nearestDist){nearest=e;nearestDist=d;}}
    // Keep an active impact in world space while the aircraft flies past it.
    if(nearest&&!field.contains(nearest.x,nearest.z,90))field.recenter(nearest.x,nearest.z);
    else if(effects.events.length===0)field.recenter(camera.x,camera.z);
    center.value.set(field.centerX,field.centerZ);
    // Whitewater's clock is local; the swell callback uses the battle's absolute time.
    simulationOffset=elapsed-effects.time-delta;
    for(const e of incoming){
      seen.add(e.id);
      if(Math.hypot(e.x-camera.x,e.z-camera.z)>1800)continue;
      const size=e.size??1;
      effects.explode({x:e.x,z:e.z,depth:e.waterDepth??(e.underwater?Math.max(3,-e.y):0),
        strength:e.waterStrength??Math.max(.03,size/3),direction:e.waterDirection});
    }
    if(seen.size>650)seen=new Set(battle.effects.map((e:any)=>e.id));
    for(const t of [...battle.torpedoes,...battle.airTorpedoes])if(t.y<=.5)field.depositFoam(t.x,t.z,2,.65*delta);
    effects.step(delta);effects.render();
  };
  return {field,effects,heightNode,normalNode,foamNode:(p:any)=>read(p).g,flowNode:(p:any)=>read(p).ba,heightAt,update,
    energy:()=>field.energy(),peak:()=>({high:Math.max(...field.height),low:Math.min(...field.height)}),
    syncTexture,packedVersion:()=>lastPackedVersion,
    // The DataTexture's own version counts uploads: `needsUpdate` bumps it, and the only thing that
    // sets `needsUpdate` here is a pack. Gates count packs with this rather than by wrapping a
    // function the render-update callback closed over and would never route through.
    uploads:()=>map.version,
    // A reset must reach the GPU: clear the packed bytes now, and force the next render to repack
    // from the field's real arrays rather than trusting the version it happens to be on.
    reset:()=>{effects.reset();seen.clear();lastBattleTime=0;elapsed=0;time.value=0;data.fill(0);map.needsUpdate=true;lastPackedVersion=-1;},
    dispose:()=>{effects.dispose();map.dispose();}};
}
