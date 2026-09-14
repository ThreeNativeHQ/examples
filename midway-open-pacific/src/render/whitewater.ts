/** Adapted from Midway Fluid Lab V2. MIT, see docs/fluid-lab-LICENSE.txt. */
import type { RippleField } from "@threenative/core";
import { clamp } from "../sim/math.js";

// SPRAY / MIST / BUBBLE / FOAM. Each slot represents a parcel, not one real droplet.
// Fixed-step secondary-fluid simulation. Typed arrays are also the GPU instance data.
const emptyStats = () => ({
  emitted: 0, dropped: 0, waterHits: 0, hullHits: 0, foamBirths: 0,
  bubblePops: 0, entrained: 0, breakups: 0, returnImpulse: 0, crestSpawns: 0,
});

export class Whitewater {
  capacity: number; wave: RippleField; heightAt: (x: number, z: number, time: number) => number;
  hullHeightAt: (x: number, z: number) => number;
  start: Float32Array; motion: Float32Array; style: Float32Array; flags: Uint8Array;
  cursor = 0; time = 0; wind = { x: 3.8, z: 1.1 };
  flow = { x: 0, z: 0 }; dirty = true; saturated = false;
  stats = emptyStats();
  constructor({capacity=12000,wave,heightAt,hullHeightAt=()=>-Infinity}: {capacity?: number; wave: RippleField; heightAt: (x:number,z:number,time:number)=>number; hullHeightAt?: (x:number,z:number)=>number}){
    if(!Number.isInteger(capacity)||capacity<1)throw new RangeError('Invalid whitewater capacity');
    this.capacity=capacity;this.wave=wave;this.heightAt=heightAt;this.hullHeightAt=hullHeightAt;
    this.start=new Float32Array(capacity*4);this.motion=new Float32Array(capacity*4);this.style=new Float32Array(capacity*4);
    this.flags=new Uint8Array(capacity);this.cursor=0;this.time=0;
    this.wind={x:3.8,z:1.1};this.flow={x:0,z:0};this.dirty=true;
    this.reset();
  }
  emit(x:number,y:number,z:number,vx:number,vy:number,vz:number,size:number,kind:number,life:number,seed=.5,drag=.1,birth=this.time){
    if(!(Number.isFinite(x)&&Number.isFinite(y)&&Number.isFinite(z)&&Number.isFinite(vx)&&Number.isFinite(vy)&&Number.isFinite(vz)
      &&Number.isFinite(size)&&Number.isFinite(kind)&&Number.isFinite(life)&&Number.isFinite(seed)&&Number.isFinite(drag)&&Number.isFinite(birth)))
      throw new TypeError('Particle parameters must be finite');
    if(size<=0||life<=0||drag<0||!Number.isInteger(kind)||kind<0||kind>3)throw new RangeError('Invalid particle style');
    if(this.saturated){this.stats.dropped++;return -1;}
    // Never replace a still-live parcel: rejecting over-budget emission cannot erase impact momentum.
    let i=-1;for(let t=0;t<this.capacity;t++){const q=(this.cursor+t)%this.capacity,k=q*4;
      if(this.motion[k+3]<=0||this.time-this.start[k+3]>=this.motion[k+3]){i=q;break;}}
    if(i<0){this.saturated=true;this.stats.dropped++;return -1;}
    const k=i*4;this.cursor=(i+1)%this.capacity;
    this.start[k]=x;this.start[k+1]=y;this.start[k+2]=z;this.start[k+3]=birth;
    this.motion[k]=vx;this.motion[k+1]=vy;this.motion[k+2]=vz;this.motion[k+3]=life;
    this.style[k]=size;this.style[k+1]=kind;this.style[k+2]=seed;this.style[k+3]=drag;
    this.flags[i]=0;this.stats.emitted++;this.dirty=true;return i;
  }
  activeCount(time=this.time){let count=0;for(let i=0;i<this.capacity;i++){const k=i*4,age=time-this.start[k+3];if(age>=0&&age<this.motion[k+3])count++;}return count;}
  counts(){const out={spray:0,mist:0,bubbles:0,foam:0};const keys=['spray','mist','bubbles','foam'];for(let i=0;i<this.capacity;i++){const k=i*4,a=this.time-this.start[k+3];if(a>=0&&a<this.motion[k+3])out[keys[this.style[k+1]] as keyof typeof out]++;}return out;}
  foam(i:number,x:number,y:number,z:number,time:number){
    const k=i*4;this.style[k+1]=3;this.style[k]=clamp(this.style[k]*2.5,.18,1.15);
    this.start[k]=x;this.start[k+1]=y+.055;this.start[k+2]=z;this.start[k+3]=time;
    this.motion[k]=0;this.motion[k+1]=0;this.motion[k+2]=0;this.motion[k+3]=5.5+this.style[k+2]*6.5;
    this.flags[i]=2;this.stats.foamBirths++;
  }
  step(dt:number,time:number){
    this.time=time;this.saturated=false;const {start:p,motion:v,style:s,wave}=this,flow=this.flow;
    for(let i=0;i<this.capacity;i++){
      const k=i*4,age=time-p[k+3];if(age<=1e-9||age>=v[k+3]||v[k+3]<=0)continue;
      const kind=s[k+1],size=s[k],seed=s[k+2],ox=p[k],oy=p[k+1],oz=p[k+2];
      if(kind===3){
        wave.flowAt(ox,oz,flow);
        let x=ox+(flow.x+this.wind.x*.012)*dt,z=oz+(flow.z+this.wind.z*.012)*dt;
        if(this.hullHeightAt(x,z)>-Infinity){x=ox;z=oz;}
        p[k]=x;p[k+2]=z;p[k+1]=this.heightAt(x,z,time)+.055;
        continue;
      }
      let x,y,z,vx,vy,vz;
      if(kind===2){
        wave.flowAt(ox,oz,flow);const e=Math.exp(-2.8*dt),rise=.65+Math.sqrt(size)*1.1;
        vx=flow.x+(v[k]-flow.x)*e;vz=flow.z+(v[k+2]-flow.z)*e;vy=rise+(v[k+1]-rise)*e;
        x=ox+vx*dt;y=oy+vy*dt;z=oz+vz*dt;
        const surface=this.heightAt(x,z,time);
        if(y>=surface-.025){
          if(this.hullHeightAt(x,z)===-Infinity){wave.depositFoam(x,z,Math.max(.65,size*2),.045+size*.08);this.foam(i,x,surface,z,time);this.stats.bubblePops++;}
          else v[k+3]=0;
          continue;
        }
      }else{
        // Exact integration of linear drag + gravity within each fixed step.
        // Fine aerosol has stronger drag and follows wind; heavy parcels retain momentum.
        const drag=kind===1?Math.max(2.0,s[k+3]):s[k+3];
        const gust=kind===1?Math.sin(ox*.07+oz*.11+time*1.7+seed*13)*.45:0;
        const wx=this.wind.x+gust,wz=this.wind.z-gust*.5,g=-9.81;
        if(drag>1e-5){
          const e=Math.exp(-drag*dt),travel=(1-e)/drag,terminal=g/drag;
          x=ox+wx*dt+(v[k]-wx)*travel;z=oz+wz*dt+(v[k+2]-wz)*travel;
          y=oy+terminal*dt+(v[k+1]-terminal)*travel;
          vx=wx+(v[k]-wx)*e;vz=wz+(v[k+2]-wz)*e;vy=terminal+(v[k+1]-terminal)*e;
        }else{x=ox+v[k]*dt;y=oy+v[k+1]*dt+.5*g*dt*dt;z=oz+v[k+2]*dt;vx=v[k];vy=v[k+1]+g*dt;vz=v[k+2];}
        // Height-limited static hull proxy. Above the deck, parcels can cross the ship.
        const deck=this.hullHeightAt(x,z);
        if(y<deck&&y>-12){
          if(oy>deck&&this.hullHeightAt(ox,oz)>-Infinity){
            // Deck absorption; no false water ripple inside the ship.
            v[k+3]=0;this.stats.hullHits++;continue;
          }
          x=ox;z=oz;vx=-vx*.22;vz=-vz*.22;vy*=.65;this.stats.hullHits++;
        }
        const oldHeight=this.heightAt(ox,oz,time-dt),newHeight=this.heightAt(x,z,time);
        // Swept signed-distance crossing follows the SAME deformed free surface as rendering.
        if(vy<0&&y<=newHeight&&((oy>=oldHeight-.04)||age>.05)&&this.hullHeightAt(x,z)===-Infinity){
          const a=clamp((oy-oldHeight)/Math.max(1e-6,(oy-oldHeight)-(y-newHeight)),0,1);
          const hx=ox+(x-ox)*a,hz=oz+(z-oz)*a,hy=this.heightAt(hx,hz,time),speed=Math.max(0,-vy);
          if(kind===0){
            const impulse=clamp(size*size*speed*.28,.012,2.2);
            wave.impulse(hx,hz,Math.max(wave.dx*.7,.6+size*2),-impulse,0);
            wave.depositFoam(hx,hz,Math.max(.65,size*2.4),clamp(.025+size*speed*.017,.03,.45));
            this.stats.waterHits++;this.stats.returnImpulse+=impulse;
          }else wave.depositFoam(hx,hz,.65,.006);
          // Some parcels entrain underwater air, then rise and turn into foam.
          if(kind===0&&seed<.18&&speed>5){
            s[k+1]=2;s[k]=Math.min(.3,size*.6);p.set([hx,hy-.15-Math.min(2,speed*.035),hz,time],k);v.set([vx*.15,.2,vz*.15,6],k);this.stats.entrained++;
          }else this.foam(i,hx,hy,hz,time);
          continue;
        }
      }
      p[k]=x;p[k+1]=y;p[k+2]=z;v[k]=vx;v[k+1]=vy;v[k+2]=vz;
      if(!wave.contains(x,z,1)||y<-90||!Number.isFinite(y)){v[k+3]=0;continue;}
      // Split a few large stretched parcels into two equal-volume children.
      // Equal/opposite velocity perturbations preserve the center-of-mass velocity.
      if(kind===0&&size>.46&&age>.48+seed*.55&&!this.flags[i]&&vy>1){
        const small=size/Math.cbrt(2),angle=seed*6.283185,dx=Math.cos(angle)*.85,dz=Math.sin(angle)*.85;
        this.flags[i]=1;
        const child=this.emit(x,y,z,vx-dx,vy,vz-dz,small,0,Math.max(.2,v[k+3]-age),1-seed,s[k+3]*1.12,time);
        if(child>=0){s[k]=small;v[k]=vx+dx;v[k+2]=vz+dz;this.flags[i]=1;this.flags[child]=1;this.stats.breakups++;}
      }
    }
    this.dirty=true;
  }
  reset(){
    this.start.fill(0);for(let i=0;i<this.capacity;i++)this.start[i*4+3]=-1000;
    this.motion.fill(0);this.style.fill(0);this.flags.fill(0);
    this.cursor=0;this.time=0;this.saturated=false;this.dirty=true;this.stats=emptyStats();
  }
}

