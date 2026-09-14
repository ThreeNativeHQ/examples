/** Fluid Lab V2's authored ejecta/cavity model, ported to TSL. MIT: docs/fluid-lab-LICENSE.txt. */
import * as T from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { attribute, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, cameraWorldMatrix,
  mix, mx_noise_float, normalWorld, positionGeometry, positionWorld, smoothstep, step, texture, uniform, uv, varying, vec2, vec3, vec4 } from "three/tsl";
import type { RippleField } from "@threenative/core";
import { clamp, rng } from "../sim/math.js";
import { Whitewater } from "./whitewater.js";

type Height = (x: number, z: number, time: number) => number;
export type WaterBlast = { x: number; z: number; depth: number; strength: number; direction?: { x: number; z: number } };
export function surfaceProfile(b: WaterBlast) {
  return { delay: .045 + b.depth * .023, radius: (4.8 + b.depth * .20) * Math.sqrt(b.strength),
    impulse: 46 * b.strength / (1 + b.depth * .027), spray: b.strength * Math.exp(-b.depth / 19) };
}
type Blast = WaterBlast & { id: number; at: number; profile: ReturnType<typeof surfaceProfile>; phase: number;
  pressure: boolean; radius: number; velocity: number; vented: boolean; collapses: number };

function cloudTexture() {
  const n = 128, data = new Uint8Array(n * n * 4);
  const hash = (x: number, y: number) => { const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return v - Math.floor(v); };
  const noise = (x: number, y: number) => { const a = Math.floor(x), b = Math.floor(y); let u = x-a, v = y-b; u=u*u*(3-2*u);v=v*v*(3-2*v); return (hash(a,b)*(1-u)+hash(a+1,b)*u)*(1-v)+(hash(a,b+1)*(1-u)+hash(a+1,b+1)*u)*v; };
  for (let y=0;y<n;y++) for(let x=0;x<n;x++) {
    const u=(x+.5)/n,v=(y+.5)/n,r=Math.hypot(u-.5,v-.5)*2;
    const f=noise(u*7,v*7)*.5+noise(u*19,v*19)*.3+noise(u*43,v*43)*.2,k=(y*n+x)*4;
    data[k]=Math.round(f*255);data[k+1]=data[k+2]=255;data[k+3]=Math.round(Math.max(0,1-r*r)**1.3*(.18+.82*f)*255);
  }
  const map=new T.DataTexture(data,n,n);map.minFilter=map.magFilter=T.LinearFilter;map.needsUpdate=true;return map;
}

export class WaterEffects {
  readonly whitewater: Whitewater;
  readonly group = new T.Group();
  readonly events: Blast[] = [];
  readonly clock = uniform(0);
  readonly cloud = cloudTexture();
  readonly particleMesh: T.Mesh;
  readonly sheets: Array<{ mesh: T.Mesh; age: ReturnType<typeof uniform> }>;
  readonly cavities: T.Mesh[];
  readonly fronts: T.Mesh[];
  private readonly instanceAttrs: T.InstancedBufferAttribute[] = [];
  private random = rng(1942);
  private serial = 0;
  private remainder = 0;
  time = 0;
  accepted = 0;
  rejected = 0;
  bubblePulses = 0;

  constructor(readonly wave: RippleField, readonly heightAt: Height, readonly hullHeightAt: (x:number,z:number)=>number,
    heightNode: (point:any)=>any) {
    this.whitewater = new Whitewater({ wave, heightAt, hullHeightAt, capacity: 12000 });
    this.group.name = "Coupled whitewater";
    const base = new T.PlaneGeometry(1,1), g = new T.InstancedBufferGeometry();
    g.setIndex(base.index!.clone());g.setAttribute("position",base.attributes.position.clone());g.setAttribute("uv",base.attributes.uv.clone());base.dispose();
    for (const [name,data] of [["pStart",this.whitewater.start],["pMotion",this.whitewater.motion],["pStyle",this.whitewater.style]] as const) {
      const attr = new T.InstancedBufferAttribute(data,4).setUsage(T.DynamicDrawUsage);
      g.setAttribute(name,attr);this.instanceAttrs.push(attr);
    }
    g.instanceCount=this.whitewater.capacity;
    const p:any=attribute("pStart","vec4"),v:any=attribute("pMotion","vec4"),style:any=attribute("pStyle","vec4");
    const age:any=this.clock.sub(p.w),kind=style.y;
    const alive=step(0,age).mul(step(v.w,age).oneMinus());
    const foam=step(2.5,kind),bubble=step(1.5,kind).sub(foam),mist=step(.5,kind).sub(step(1.5,kind));
    const scale=style.x.mul(alive).mul(mix(1,age.min(2).mul(.45).add(1),mist));
    const vel:any=cameraViewMatrix.mul(vec4(v.xyz,0)).xyz;
    const dir=vel.xy.add(vec2(.0001,.0002)).normalize();
    const stretch=mix(vel.length().mul(.055).min(2.8).add(1),1,step(.5,kind));
    const q:any=positionGeometry.xy.mul(scale).mul(2);
    const offset=vec2(dir.y,dir.x.negate()).mul(q.x).add(dir.mul(q.y).mul(stretch));
    const billboard:any=cameraWorldMatrix.mul(vec4(offset.x,offset.y,0,0)).xyz;
    const angle=style.z.mul(Math.PI*2),c=angle.cos(),s=angle.sin();
    const flat=vec3(q.x.mul(c).sub(q.y.mul(s)),0,q.x.mul(s).add(q.y.mul(c)));
    const wp:any=p.xyz.add(mix(billboard,flat,foam));
    const world:any=varying(wp);
    const mat=new MeshBasicNodeMaterial({transparent:true,depthWrite:false,side:T.DoubleSide});
    mat.vertexNode=cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(wp,1)));
    const disc:any=uv().mul(2).sub(1),rr=disc.dot(disc),edge=smoothstep(.65,1,rr).oneMinus();
    const noise=texture(this.cloud,uv()).r;
    const density=texture(this.cloud,uv()).a;
    const n=vec3(disc,rr.oneMinus().max(.001).sqrt()).normalize();
    const lit=n.dot(vec3(-.45,.6,.55).normalize()).max(0);
    const rgb=mix(vec3(.19,.32,.37),vec3(.82,.89,.89),lit.mul(.65).add(.35))
      .add(n.dot(vec3(-.35,.7,1).normalize()).max(0).pow(42).mul(.5));
    mat.colorNode=mix(mix(rgb,mix(vec3(.4,.53,.57),vec3(.87,.91,.9),noise),mist),vec3(.4,.77,.83).add(lit.mul(.18)),bubble);
    const alpha=mix(mix(edge.mul(.62).mul(noise.mul(.4).add(.6)),density.mul(.23),mist),
      smoothstep(.42,.77,rr.sqrt()).sub(smoothstep(.77,1,rr.sqrt())).mul(.52),bubble);
    const dy=world.y.sub(heightNode(world.xz));
    const wet=mix(smoothstep(-.12,.48,dy),smoothstep(-.08,.15,dy).oneMinus(),bubble);
    mat.opacityNode=mix(alpha,density.mul(.15),foam).mul(alive).mul(smoothstep(0,.035,age))
      .mul(smoothstep(.66,1,age.div(v.w.max(.001))).oneMinus()).mul(mix(wet,1,foam));
    this.particleMesh=new T.Mesh(g,mat);this.particleMesh.frustumCulled=false;this.particleMesh.renderOrder=4;
    this.particleMesh.name="Spray, mist, bubbles and floating foam";this.group.add(this.particleMesh);
    this.sheets=Array.from({length:8},()=>{
      const age:any=uniform(0),geometry=new T.PlaneGeometry(1,1,48,18);
      const material=new MeshBasicNodeMaterial({transparent:true,depthWrite:false,side:T.DoubleSide});
      const n=mx_noise_float(positionWorld.mul(1.8).add(vec3(0,age.mul(-4),0))).mul(.5).add(.5);
      const detail=mx_noise_float(positionWorld.mul(4.14)).mul(.5).add(.5);
      const froth=n.mul(.7).add(detail.mul(.3));
      material.colorNode=mix(vec3(.055,.18,.22),vec3(.63,.75,.77),froth.mul(.6).add(.4));
      material.opacityNode=smoothstep(smoothstep(.35,2.1,age).mul(.36).add(uv().y.mul(.13)),.6,froth)
        .mul(smoothstep(0,.06,age)).mul(smoothstep(1.35,2.65,age).oneMinus())
        .mul(smoothstep(0,.1,uv().y)).mul(smoothstep(.96,1,uv().y).oneMinus()).mul(.88);
      const mesh=new T.Mesh(geometry,material);mesh.visible=false;mesh.frustumCulled=false;mesh.renderOrder=3;
      mesh.name="Torn ballistic water curtain";this.group.add(mesh);return {mesh,age};
    });
    const sphere=new T.SphereGeometry(1,24,16);
    this.cavities=Array.from({length:8},()=>{
      const material=new MeshBasicNodeMaterial({color:0x74aeb5,transparent:true,opacity:.13,depthWrite:false});
      const mesh=new T.Mesh(sphere,material);mesh.visible=false;mesh.renderOrder=-3;this.group.add(mesh);return mesh;
    });
    this.fronts=Array.from({length:8},()=>{
      const material=new MeshBasicNodeMaterial({color:0x8cbcc9,transparent:true,opacity:.04,depthWrite:false,side:T.DoubleSide});
      material.opacityNode=normalWorld.dot(cameraPosition.sub(positionWorld).normalize()).abs().oneMinus().pow(2)
        .mul(smoothstep(-.1,.1,positionWorld.y.sub(heightNode(positionWorld.xz))).oneMinus()).mul(.035);
      const mesh=new T.Mesh(sphere,material);mesh.visible=false;mesh.renderOrder=-3;this.group.add(mesh);return mesh;
    });
  }

  explode(input: WaterBlast): boolean {
    if (![input.x,input.z,input.depth,input.strength].every(Number.isFinite)) return false;
    if (this.events.length>=8 || !this.wave.contains(input.x,input.z,20)) {this.rejected++;return false;}
    const b={...input,depth:clamp(input.depth,0,60),strength:clamp(input.strength,.03,2.5)};
    this.events.push({...b,id:++this.serial,at:this.time,profile:surfaceProfile(b),phase:0,pressure:false,
      radius:.35,velocity:(19+7*Math.sqrt(b.strength))/(1+b.depth*.008),vented:false,collapses:0});
    for(let i=0;i<140*b.strength;i++){
      const a=this.range(0,Math.PI*2),d=this.range(.1,3.2),x=b.x+Math.cos(a)*d,z=b.z+Math.sin(a)*d;
      if(this.hullHeightAt(x,z)>-Infinity)continue;
      this.whitewater.emit(x,this.heightAt(x,z,this.time)-b.depth+this.range(-1.5,0),z,this.range(-1.2,1.2),this.range(.2,2),this.range(-1.2,1.2),this.range(.045,.26),2,this.range(5,12),this.random(),.1,this.time);
    }
    this.accepted++;return true;
  }
  private range(a:number,b:number){return a+(b-a)*this.random();}
  private plume(b:Blast,phase:number){
    const p=b.profile,power=Math.sqrt(p.spray);if(power<.07)return;
    for(let i=0;i<Math.floor(375*Math.min(1.8,p.spray));i++){
      const finger=i%19,a=finger*Math.PI*2/19+this.range(-.09,.09),jitter=this.range(.82,1.16);
      const out=(6+9*(.5+.5*Math.sin(finger*1.7)))*power*jitter,rad=Math.sqrt(this.random())*p.radius*.5;
      const x=b.x+Math.cos(a)*rad,z=b.z+Math.sin(a)*rad;
      if(this.hullHeightAt(x,z)>-Infinity)continue;
      let vx=Math.cos(a)*out,vz=Math.sin(a)*out;
      if(b.direction){const dot=vx*b.direction.x+vz*b.direction.z;if(dot<0){vx-=dot*b.direction.x*1.8;vz-=dot*b.direction.z*1.8;}}
      const vy=(25+14*(.5+.5*Math.sin(finger*2.3)))*power*jitter*(1-phase*.047);
      const size=(this.random()<.012?this.range(.5,.7):this.range(.035,.25))*(.8+power*.45);
      this.whitewater.emit(x,this.heightAt(x,z,this.time)+this.range(.14,.8),z,vx,vy,vz,size,0,9,this.random(),this.range(.06,.18),this.time);
    }
    for(let i=0;i<Math.floor(22*Math.min(1.7,p.spray));i++){
      const a=this.range(0,Math.PI*2),d=this.range(0,p.radius*.5),x=b.x+Math.cos(a)*d,z=b.z+Math.sin(a)*d;
      if(this.hullHeightAt(x,z)>-Infinity)continue;
      this.whitewater.emit(x,this.heightAt(x,z,this.time)+this.range(.5,3),z,Math.cos(a)*7*power,this.range(8,18)*power,Math.sin(a)*7*power,this.range(.55,1.5),1,this.range(2.5,5.5),this.random(),this.range(2,4),this.time);
    }
  }
  step(dt:number){
    // Same fixed substep for wave forcing and droplet crossings; pause adds no simulation time.
    this.remainder+=Math.min(Math.max(0,dt),.2);
    const h=1/120;
    while(this.remainder>=h-1e-9){
      this.remainder-=h;this.time+=h;
      for(const e of this.events){
        const age=this.time-e.at;
        if(!e.pressure&&age>=e.profile.delay){this.wave.impulse(e.x,e.z,e.profile.radius,e.profile.impulse*.72,0);e.pressure=true;}
        while(e.phase<7&&age>=e.profile.delay+e.phase*.072)this.plume(e,e.phase++);
        const omega=1.8+e.depth*.028;
        e.velocity+=(-omega*omega*e.radius-(e.vented?1.4:.58)*e.velocity)*h;e.radius+=e.velocity*h;
        if(e.radius>e.depth+.2)e.vented=true;
        if(e.radius<.25){
          if(e.velocity<-.3&&e.collapses<2){this.wave.impulse(e.x,e.z,e.profile.radius*1.15,Math.min(8,-e.velocity*.3)*e.strength,0);e.velocity*=-.36;e.collapses++;this.bubblePulses++;}
          else e.velocity=0;
          e.radius=.25;
        }
      }
      this.wave.advance(h);this.whitewater.step(h,this.time);
    }
    for(let i=this.events.length-1;i>=0;i--)if(this.time-this.events[i].at>10)this.events.splice(i,1);
  }
  render(){
    this.clock.value=this.time;
    if(this.whitewater.dirty){for(const a of this.instanceAttrs)a.needsUpdate=true;this.whitewater.dirty=false;}
    for(let k=0;k<8;k++){
      const e=this.events[k],slot=this.sheets[k],age=e?this.time-e.at:100,t=e?age-e.profile.delay:100;
      slot.mesh.visible=!!e&&t>=0&&t<2.7&&e.profile.spray>=.12;
      if(slot.mesh.visible){
        slot.age.value=t;const arr=slot.mesh.geometry.attributes.position.array,power=Math.sqrt(e.profile.spray);
        for(let j=0;j<=18;j++)for(let i=0;i<=48;i++){
          const q=j/18,a=i/48*Math.PI*2,finger=.62+.23*Math.sin(a*9+e.id*1.7)+.14*Math.sin(a*15-1.3);
          const r=(e.profile.radius*.35*(1-.55*q)+(4.2+3.5*finger)*power*t*q)*(1+.12*Math.sin(a*7+q*5));
          let dx=Math.cos(a)*r,dz=Math.sin(a)*r;
          if(e.direction){const d=dx*e.direction.x+dz*e.direction.z;if(d<0){dx-=d*e.direction.x*1.8;dz-=d*e.direction.z*1.8;}}
          const x=e.x+dx,z=e.z+dz;
          let y=Math.max(0,(24+14*finger)*power*t-4.905*t*t)*q**.92+this.heightAt(x,z,this.time)*(1-q)+.1;
          if(this.hullHeightAt(x,z)>y)y=this.heightAt(x,z,this.time)-.15;
          const n=(j*49+i)*3;arr[n]=x;arr[n+1]=y;arr[n+2]=z;
        }
        slot.mesh.geometry.attributes.position.needsUpdate=true;
      }
      const cavity=this.cavities[k];cavity.visible=!!e&&age<5;
      if(cavity.visible){cavity.position.set(e.x,-e.depth+Math.min(e.depth*.3,age*.3),e.z);cavity.scale.set(e.radius,e.radius*(e.vented?.73:1),e.radius);}
      const front=this.fronts[k];front.visible=!!e&&age>=0&&age<.18;
      if(front.visible){front.position.set(e.x,-e.depth,e.z);front.scale.setScalar(Math.max(.1,1500*age));(front.material as T.Material).opacity=.04*e.strength*Math.exp(-age*18);}
    }
  }
  reset(){this.events.length=0;this.time=0;this.remainder=0;this.serial=0;this.accepted=0;this.rejected=0;this.bubblePulses=0;this.random=rng(1942);this.whitewater.reset();this.wave.reset();this.render();}
  dispose(){this.group.removeFromParent();this.particleMesh.geometry.dispose();(this.particleMesh.material as T.Material).dispose();this.cloud.dispose();
    for(const s of this.sheets){s.mesh.geometry.dispose();(s.mesh.material as T.Material).dispose();}
    this.cavities[0].geometry.dispose();for(const m of [...this.cavities,...this.fronts])(m.material as T.Material).dispose();}
}
