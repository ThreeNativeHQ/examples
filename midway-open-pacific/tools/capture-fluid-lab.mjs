/** Actual game world, deterministic bomb/torpedo/deep-water sequences. Always use capture-lock.sh. */
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
const url=process.env.MIDWAY_URL||'http://127.0.0.1:5386';
const out=process.env.MIDWAY_SHOTS||'screenshots/fluid-lab';await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:false,args:['--enable-unsafe-webgpu','--enable-features=Vulkan','--disable-gpu-sandbox','--ignore-gpu-blocklist','--ozone-platform=x11']});
const errors=[];
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 await page.goto(url);await page.waitForSelector('#loading.hidden',{state:'attached',timeout:180000});
 const adapter=await page.evaluate(async()=>{const a=await navigator.gpu.requestAdapter();return a?{vendor:a.info.vendor,architecture:a.info.architecture}:null});
 assert.ok(adapter&&!/swiftshader|llvmpipe|software/i.test(JSON.stringify(adapter)));console.log('adapter',adapter);
 await page.evaluate(async()=>{
   const url=performance.getEntriesByType('resource').map(e=>e.name).findLast(n=>/\/src\/game\.ts(?:\?|$)/.test(n));
   const m=(await import(url)).default.scene;window.midway=m;m.paused=true;
   if(!m.world.ripples.effects)throw Error('Server is not running the coupled fluid implementation');
   const b=m.battle,w=m.world,s=b.ships.find(s=>s.team==='jp'&&s.kind==='carrier');window.ship=s;
    b.player.x=s.x+1500;b.player.y=400;b.player.z=s.z;b.status='playing';
   const style=document.createElement('style');style.textContent='#hud,#flight-ui,#briefing,#subtitles,#messages,.threenative-brand {visibility:hidden!important}';document.head.append(style);
   // Fix only the observation camera. Weapons still use Battle.updateWeapons and damageShip.
   window.view='surface';w.updateCamera=()=>{const c=Math.cos(s.heading),sn=Math.sin(s.heading);
     if(window.view==='aerial')w.camera.position.set(s.x+c*140,s.y+260,s.z+sn*140);
     else if(window.view==='underwater')w.camera.position.set(s.x+c*90,-7,s.z+sn*90-c*45);
     else w.camera.position.set(s.x+c*285+sn*100,75,s.z+sn*285-c*100);
     w.camera.lookAt(s.x+c*12,window.view==='underwater'?-3:6,s.z+sn*12);w.camera.fov=48;w.camera.updateProjectionMatrix();};
   w.ripples.reset();w.update(0,0,false);
   window.advance=(seconds)=>{for(let i=0;i<Math.round(seconds*60);i++){b.time+=1/60;b.updateWeapons(1/60);w.update(1/60,b.time,false);}};
   window.read=()=>({time:b.time,energy:w.ripples.energy(),...w.ripples.effects.whitewater.stats,...w.ripples.effects.whitewater.counts(),accepted:w.ripples.effects.accepted,position:w.meshes.get(s.id).position.toArray(),rotation:w.meshes.get(s.id).rotation.toArray()});
 });
 const shot=async(name)=>{await page.waitForTimeout(120);await page.screenshot({path:`${out}/${name}.png`});};
 await shot('calm');
 const before=await page.evaluate(()=>read());
 await page.evaluate(()=>{
   const b=midway.battle,s=ship,c=Math.cos(s.heading),sn=Math.sin(s.heading);
   b.damageShip(s,120,{x:s.x+c*s.hullBeam*.5,y:-3,z:s.z+sn*s.hullBeam*.5},'torpedo','us',{owner:'player'});
   advance(1.1);
 });
 const plume=await page.evaluate(()=>read());assert.ok(plume.energy>0&&plume.spray>300&&plume.accepted===1,JSON.stringify(plume));
 assert.ok(Math.abs(plume.rotation[2]-before.rotation[2])>.005,'real ship transform reacts');
 await shot('torpedo-plume');
 await page.evaluate(()=>advance(5.6));const returning=await page.evaluate(()=>read());
 assert.ok(returning.waterHits>100&&returning.returnImpulse>0&&returning.foam>100,'returning water couples to surface');await shot('torpedo-foam');
 await page.evaluate(()=>{window.view='aerial';midway.world.update(0,midway.battle.time,false)});await shot('aerial-foam');
 const paused=await page.evaluate(()=>read());await page.waitForTimeout(250);assert.deepEqual(await page.evaluate(()=>read()),paused,'pause freezes water and ship response');
 await page.evaluate(()=>{const w=midway.world,b=midway.battle;w.ripples.reset();b.effects=[];w.update(0,b.time,false);window.view='surface';
   const s=ship,c=Math.cos(s.heading),sn=Math.sin(s.heading);b.bombs.push({id:b.id('bomb'),x:s.x+c*70,y:8,z:s.z+sn*70,vx:0,vy:-120,vz:0,team:'us',owner:'player',age:0,damage:155,stamp:null});advance(1.4);});
 const bomb=await page.evaluate(()=>read());assert.ok(bomb.accepted===1&&bomb.spray>300,'real bomb entering water reaches coupled renderer');await shot('bomb-plume');
 await page.evaluate(()=>{const w=midway.world,b=midway.battle;w.ripples.reset();b.effects=[];w.update(0,b.time,false);
   const s=ship,c=Math.cos(s.heading),sn=Math.sin(s.heading);b.fx('splash',{x:s.x+c*70,y:-35,z:s.z+sn*70,waterKind:'deep',waterDepth:35},3.6,true);advance(.3);});
 const deepEarly=await page.evaluate(()=>read());assert.equal(deepEarly.spray,0,'deep blast cannot break surface immediately');
 await page.evaluate(()=>advance(1.1));const deep=await page.evaluate(()=>read());assert.ok(deep.energy>0&&deep.spray<bomb.spray*.45,'depth attenuates and delays plume');await shot('deep-heave');
 await page.evaluate(()=>{window.view='underwater';midway.world.update(0,midway.battle.time,false)});await shot('underwater');
 await page.evaluate(()=>{const w=midway.world;w.ripples.reset();w.ripples.effects.render()});
 assert.equal(await page.evaluate(()=>midway.world.ripples.effects.whitewater.activeCount()),0,'reset clears active parcels');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({plume,returning,bomb,deep,errors},null,2));
}finally{await browser.close()}
