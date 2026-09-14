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
   window.view='surface';window.gameCamera=w.updateCamera.bind(w);w.updateCamera=()=>{const c=Math.cos(s.heading),sn=Math.sin(s.heading);
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
 // ---- ripple packing: where the 147,456 half-float conversions an update actually happen ----
 // The pack used to run at the end of every `ripples.update`, whether the solver had changed a cell
 // or not and whether or not that update ever reached a render. It now runs from the centre
 // uniform's render update, guarded on the field's own version. These are real renders on the real
 // scene: `advance()` runs updates synchronously with no frame in between, so the counts separate
 // "how many updates" from "how many packs". `uploads()` is the ripple texture's own version, which
 // only a pack moves, so nothing is stubbed to observe this.
 await page.evaluate(()=>{const b=midway.battle,s=ship,c=Math.cos(s.heading),sn=Math.sin(s.heading);
   midway.world.ripples.reset();b.effects=[];b.fx('splash',{x:s.x+c*70,y:-3,z:s.z+sn*70,waterKind:'torpedo',waterDepth:3},2,true);advance(.4);});
 await page.waitForTimeout(200);
 const packing=await page.evaluate(async()=>{
   const r=midway.world.ripples,f=r.field;
   const frames=(n)=>new Promise(done=>{const tick=()=>(--n>0?requestAnimationFrame(tick):done());requestAnimationFrame(tick);});
   // Two fixed updates with no frame between them.
   const start=r.uploads(),v0=f.version;
   advance(2/60);
   const duringUpdates=r.uploads()-start;
   const versionsSolved=f.version-v0;
   // Now let real frames happen: the first material consumer packs once, for the latest version.
   await frames(3);
   const afterRender=r.uploads()-start;
   const synced=r.packedVersion()===f.version;
   // Nothing has changed since: more frames, water reflection and shadow passes included, pack nothing.
   await frames(4);
   const afterIdle=r.uploads()-start;
   // A reset has to reach the GPU even though the field is flat again. Clear the live effect list
   // with it: `reset` also forgets which effects it has already consumed, so a splash still inside
   // its five-second life would legitimately be accepted a second time and disturb the water again.
   midway.battle.effects.length=0;
   r.reset();
   await frames(3);
   const afterReset=r.uploads()-start;
   // And from there the empty patch follows the camera: its centre moves, its image does not.
   const beforeVersion=f.version,cx=f.centerX,uploadsBefore=r.uploads();
   for(let i=1;i<=8;i++)f.recenter(cx+i*f.dx*3,0);
   const movedCentre=f.centerX-cx;
   const emptyRecenterVersions=f.version-beforeVersion;
   await frames(4);
   const emptyRecenterUploads=r.uploads()-uploadsBefore;
   return {duringUpdates,versionsSolved,afterRender,afterIdle,afterReset,synced,movedCentre,emptyRecenterVersions,emptyRecenterUploads};
 });
 assert.equal(packing.duringUpdates,0,`packing left the update path: ${JSON.stringify(packing)}`);
 assert.ok(packing.versionsSolved>0,`the two updates really solved the field: ${JSON.stringify(packing)}`);
 assert.equal(packing.afterRender,1,`two updates then frames pack exactly once, for the latest version: ${JSON.stringify(packing)}`);
 assert.ok(packing.synced,`the packed bytes are that latest version, in that same render: ${JSON.stringify(packing)}`);
 assert.equal(packing.afterIdle,1,`unchanged frames, reflection and shadow passes included, pack nothing: ${JSON.stringify(packing)}`);
 assert.ok(packing.afterReset>packing.afterIdle,`a reset still reaches the GPU: ${JSON.stringify(packing)}`);
 assert.ok(packing.movedCentre>0,`the empty patch really followed the camera: ${JSON.stringify(packing)}`);
 assert.equal(packing.emptyRecenterVersions,0,`an empty patch moving announces no new image: ${JSON.stringify(packing)}`);
 assert.equal(packing.emptyRecenterUploads,0,`and uploads nothing while it does: ${JSON.stringify(packing)}`);
 console.log('packing',JSON.stringify(packing));

 // ---- artificial horizon: two static images and two scalars, not a canvas repainted per frame ----
 const cockpit=await page.evaluate(async()=>{
   const m=midway,w=m.world,b=m.battle;
   w.updateCamera=window.gameCamera;
   const s=ship,c=Math.cos(s.heading),sn=Math.sin(s.heading);
   // Fly the player off the carrier's bow so the deck, the sea and the horizon are all in frame,
   // and put the aircraft on a moving parent's heading rather than a frozen one.
   Object.assign(b.player,{x:s.x-c*900,y:260,z:s.z-sn*900,heading:s.heading,pitch:0,roll:0,speed:92,
     vx:c*92,vy:0,vz:sn*92,autopilot:false,throttle:.8,gear:0,trim:.1,rudder:.2,elevator:-.1});
   if(b.player.flight?.setAttitude)b.player.flight.setAttitude(s.heading,0,0);
   b.player.attitude=null;
   w.setCamera(1);w.snap=true;w.update(0,b.time,false);
   // Every texture the cockpit's materials hold, and its canvas textures specifically: the old
   // artificial horizon was a CanvasTexture repainted and re-uploaded on every update.
   const seen=new Map();
   w.scene.traverse(o=>{const mats=Array.isArray(o.material)?o.material:o.material?[o.material]:[];
     for(const mat of mats)for(const [slot,v] of Object.entries(mat))
       if(v&&v.isTexture&&!seen.has(v))seen.set(v,{slot,name:mat.name,canvas:!!v.isCanvasTexture,version:v.version});});
   const canvasTextures=[...seen.values()].filter(t=>t.canvas);
   window.horizonWatch=[...seen.entries()].filter(([,d])=>d.canvas).map(([t,d])=>({t,name:d.name,slot:d.slot,version:t.version}));
   return {canvasTextures:canvasTextures.length,textures:seen.size,
     horizonCanvas:canvasTextures.filter(t=>/horizon|attitude/i.test(t.name||'')),
     horizonMaterials:[...seen.values()].filter(t=>/horizon|attitude/i.test(t.name||'')).map(t=>({name:t.name,slot:t.slot,canvas:t.canvas}))};
 });
 // The scene still holds a few painted-once canvas textures — deck markings, wake, scorch — and
 // they are fine: they were drawn at build time and never rewritten. What must not exist any more
 // is a canvas texture on the artificial horizon, and no canvas texture at all may change version
 // while the dial is flown through its whole range.
 assert.deepEqual(cockpit.horizonCanvas,[],`the artificial horizon holds no canvas texture: ${JSON.stringify(cockpit.horizonCanvas)}`);
 await shot('cockpit-wide');
 // The automated checks above are blind to how the dial looks, and the pilot's eye does not frame
 // the instrument panel, so put the camera on the horizon's own face: find the mesh wearing that
 // material, and look at it down its own normal. Every attitude below is then a picture a person
 // can compare against the old canvas dial.
 const framed=await page.evaluate(()=>{
   const w=midway.world;let target=null;
   w.scene.traverse(o=>{const m=o.material;if(!target&&m&&!Array.isArray(m)&&m.name==='Live artificial horizon')target=o;});
   if(!target)return false;
   target.updateWorldMatrix(true,false);
   window.dial=target;
   // `optimize()` merged this dial into one mesh per material, so the object's origin is the
   // cockpit group's, not the instrument's. Its bounding sphere is where the dial actually is.
   target.geometry.computeBoundingSphere();
   const V3=Object.getPrototypeOf(w.camera.position).constructor;
   const Q=Object.getPrototypeOf(w.camera.quaternion).constructor;
   const local=target.geometry.boundingSphere.center,radius=target.geometry.boundingSphere.radius;
   w.updateCamera=()=>{
     const centre=local.clone().applyMatrix4(target.matrixWorld);
     const n=new V3(0,0,1).applyQuaternion(target.getWorldQuaternion(new Q()));
     w.camera.position.copy(centre).addScaledVector(n,radius*2.4);
     w.camera.up.set(0,1,0);w.camera.fov=45;w.camera.lookAt(centre);
     w.camera.updateProjectionMatrix();w.camera.updateMatrixWorld();
   };
   return {radius:+radius.toFixed(4)};
 });
 assert.ok(framed&&framed.radius>0,`the artificial horizon material is on a real mesh in the scene: ${JSON.stringify(framed)}`);
 const views=[['level',0,0],['climb-right',.35,.6],['dive-left',-.35,-.6],['pitch-limit',1.6,0],['roll-limit',0,3.6]];
 for(const [name,pitch,roll] of views){
   await page.evaluate(([pitch,roll])=>{const b=midway.battle;b.player.pitch=pitch;b.player.roll=roll;
     midway.world.update(0,b.time,false);},[pitch,roll]);
   await shot(`attitude-${name}`);
 }
 // Flying the dial through its whole range must not have touched a single texture version, and the
 // cockpit's merged static meshes must have stopped recomposing without freezing where they are.
 const after=await page.evaluate(()=>{
   const w=midway.world;let changed=0,frozen=0,moved=0;
   const seen=new Set();
   w.scene.traverse(o=>{
     if(o.matrixAutoUpdate===false&&o.isMesh){frozen++;
       const world=o.matrixWorld.elements;if(Math.hypot(world[12],world[13],world[14])>0)moved++;}
     const mats=Array.isArray(o.material)?o.material:o.material?[o.material]:[];
     for(const mat of mats)for(const v of Object.values(mat))
       if(v&&v.isTexture&&!seen.has(v)){seen.add(v);if(v.isCanvasTexture)changed++;}
   });
   // Not "is there a canvas texture" but "did one get rewritten": an upload is a version change.
   const rewritten=(window.horizonWatch||[]).filter(w=>w.t.version!==w.version)
     .map(w=>({name:w.name,slot:w.slot,from:w.version,to:w.t.version}));
   return {frozen,moved,canvasTextures:changed,rewritten,cameraMode:w.cameraMode,
     eye:w.camera.position.toArray().map(v=>+v.toFixed(3))};
 });
 assert.deepEqual(after.rewritten,[],`the whole flight ran without one canvas texture upload: ${JSON.stringify(after.rewritten)}`);
 assert.ok(after.frozen>0,`static cockpit meshes stopped recomposing: ${JSON.stringify(after)}`);
 assert.ok(after.moved>0,`and are still carried to a real world position: ${JSON.stringify(after)}`);
 assert.equal(after.cameraMode,1,'the capture really flew the cockpit view');
 assert.ok(after.eye.some(v=>v!==0),'the dial camera reached a real world position');
 console.log('cockpit',JSON.stringify({...cockpit,...after}));

 assert.deepEqual(errors,[]);console.log(JSON.stringify({plume,returning,bomb,deep,errors},null,2));
}finally{await browser.close()}
