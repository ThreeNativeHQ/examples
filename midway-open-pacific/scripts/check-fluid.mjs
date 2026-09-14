import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { RippleField } from '@threenative/core';
const source=await build({stdin:{contents:`export {Whitewater} from './src/render/whitewater.ts'; export {shipMotion} from './src/render/ship-motion.ts'; export {Battle} from './src/sim/battle.ts'; export {localPoint} from './src/sim/math.ts'; export {createHullQuery} from './src/render/hull-query.ts';`,resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const {Whitewater,shipMotion,Battle,localPoint,createHullQuery}=await import(`data:text/javascript;base64,${Buffer.from(source.outputFiles[0].text).toString('base64')}`);
const wave=new RippleField({resolution:64,size:160,step:1/120});
const height=(x,z,t)=>Math.sin(t)*.3+wave.heightAt(x,z);
const water=new Whitewater({wave,heightAt:height,capacity:64});
water.emit(0,4,0,0,-8,0,.25,0,9,.5,0);
for(let i=1;i<=240;i++){wave.advance(1/120);water.step(1/120,i/120);}
assert.equal(water.stats.waterHits,1,'one swept crossing returns momentum exactly once');
assert.ok(water.stats.returnImpulse>0&&wave.energy()>0,'droplet drives actual wave energy');
assert.equal(water.counts().foam,1,'water parcel becomes floating foam');
assert.ok(Math.abs(water.start[1]-height(water.start[0],water.start[2],2)-.055)<1e-5,'foam rides the same deformed surface');
water.reset();wave.reset();
water.emit(0,-.1,0,0,1,0,.2,2,8,.5,.1);
for(let i=1;i<=120;i++)water.step(1/120,i/120);
assert.equal(water.stats.bubblePops,1,'rising bubble pops');
assert.equal(water.counts().foam,1,'bubble becomes persistent foam');
water.reset();
for(let i=0;i<64;i++)assert.ok(water.emit(i,10,0,0,0,0,.1,0,8)>=0);
assert.equal(water.emit(0,10,0,0,0,0,.1,0,8),-1,'full pool rejects without erasing live parcels');
assert.equal(water.activeCount(),64);
const b=new Battle(),s=b.ships.find(s=>s.kind==='carrier'&&s.team==='jp');
const right={x:Math.cos(s.heading),z:Math.sin(s.heading)};
b.damageShip(s,120,{x:s.x+right.x*s.hullBeam*.5,y:-3,z:s.z+right.z*s.hullBeam*.5},'torpedo','us',{owner:'player'});
const event=b.effects.find(e=>e.waterKind==='torpedo');
assert.ok(event&&event.underwater&&event.waterDepth===3,'actual torpedo damage emits typed submerged water blast');
const flat=()=>0,p=shipMotion(s,b.time+.8,flat);
assert.ok(Math.abs(p.roll)>.01&&Math.hypot(p.x,p.z)>.2,'real hit record rocks and displaces the visible hull');
const opposite={...s,impacts:s.impacts.map(h=>({...h,right:-h.right}))},o=shipMotion(opposite,b.time+.8,flat);
assert.ok(Math.abs(p.roll+o.roll)<1e-9,'opposite hull side reverses roll');
assert.ok(Math.abs(shipMotion(s,b.time+20,flat).roll)<.001,'hit rocking decays');
const destroyer={...s,hullLength:s.hullLength*.5};
assert.ok(Math.abs(shipMotion(destroyer,b.time+.8,flat).roll)>Math.abs(p.roll),'smaller hull responds more');
assert.deepEqual(shipMotion({...s,impacts:[]},b.time,flat),{x:0,y:0,z:0,pitch:0,roll:0});
// The cached hull query must answer exactly what the original per-call formula answered. That
// formula is the oracle here, written out once, and the two are compared over seeded points around
// several headings, an overlapping pair, a sunk hull and a submerged submarine. A query that is
// merely fast and subtly narrower would put whitewater through a flight deck.
const oracle=(vessels,x,z)=>{
  for(const s of vessels){
    if(s.sunk||(s.kind==='sub'&&!s.surfaced))continue;
    if(Math.abs(x-s.x)>s.hullLength||Math.abs(z-s.z)>s.hullLength)continue;
    const l=localPoint({x,z},s);
    const taper=Math.sqrt(Math.max(0,1-(l.forward/(s.hullLength*.5))**4));
    if(Math.abs(l.forward)<s.hullLength*.5&&Math.abs(l.right)<s.hullBeam*.5*taper)return s.deckHeight??12;
  }
  return -Infinity;
};
const hull=(over)=>({x:0,z:0,heading:0,hullLength:250,hullBeam:32,deckHeight:19,kind:'carrier',sunk:false,surfaced:true,...over});
// A seeded LCG: the same points every run, so a failure is reproducible.
let seed=19420604;
const rand=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
const fleets=[
  [hull({heading:0})],
  [hull({heading:Math.PI/2})],
  [hull({heading:-2.37})],
  [hull({heading:.8}),hull({x:40,z:-25,heading:.8+1.1,hullLength:120,hullBeam:12,deckHeight:8,kind:'destroyer'})],
  [hull({sunk:true}),hull({x:30,z:30,heading:1.9,hullLength:160,hullBeam:18,deckHeight:11,kind:'cruiser'})],
  [hull({kind:'sub',surfaced:false,hullLength:95,hullBeam:9}),hull({x:-70,z:12,heading:-.4,kind:'sub',surfaced:true,hullLength:95,hullBeam:9,deckHeight:6})],
];
const q=createHullQuery();
let onHull=0;
for(const fleet of fleets){
  q.cache(fleet);
  for(let i=0;i<4000;i++){
    // Half the points sweep the open sea, so the broad rejects are exercised; half are aimed just
    // inside and just outside a hull's own oriented box, where the taper decides the answer.
    const s=fleet[i%fleet.length];
    const aimed=i%2===0;
    const x=aimed?s.x+(rand()-.5)*s.hullLength*1.2*Math.sin(s.heading)+(rand()-.5)*s.hullBeam*1.3*Math.cos(s.heading):(rand()-.5)*600;
    const z=aimed?s.z-(rand()-.5)*s.hullLength*1.2*Math.cos(s.heading)+(rand()-.5)*s.hullBeam*1.3*Math.sin(s.heading):(rand()-.5)*600;
    const expected=oracle(fleet,x,z);
    const actual=q.heightAt(x,z);
    assert.equal(actual,expected,`hull query at ${x.toFixed(3)},${z.toFixed(3)} gave ${actual} not ${expected}`);
    if(expected>-Infinity)onHull++;
  }
  // The edge is where a taper test goes wrong, so walk the exact rim of every hull too.
  for(const s of fleet)for(let k=0;k<720;k++){
    const a=k*Math.PI/360;
    for(const r of [.995,1,1.005]){
      const f=Math.cos(a)*s.hullLength*.5*r,side=Math.sin(a)*s.hullBeam*.5*r;
      const x=s.x+f*Math.sin(s.heading)+side*Math.cos(s.heading);
      const z=s.z-f*Math.cos(s.heading)+side*Math.sin(s.heading);
      assert.equal(q.heightAt(x,z),oracle(fleet,x,z),`hull rim at heading ${s.heading} radius ${r}`);
    }
  }
}
assert.ok(onHull>3000,`the seeded points actually land on hulls: ${onHull}`);
// The cache is rebuilt, never accumulated: a fleet that sails away leaves nothing behind.
q.cache([]);
assert.equal(q.heightAt(0,0),-Infinity,'an emptied fleet answers open water');
q.cache([hull({x:1000,z:1000})]);
assert.equal(q.heightAt(0,0),-Infinity,'a hull that moved away is no longer under the old point');
assert.equal(q.heightAt(1000,1000),19,'and is under its new one');

console.log('PASS: swept splashback, persistent surface foam, rising bubbles, bounded pool, actual torpedo event, opposite-side hull motion and decay, cached hull query equals its formula.');
