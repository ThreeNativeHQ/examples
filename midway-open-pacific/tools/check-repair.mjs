/** Browser regression: keyboard-only steering, mouse fire/free-look, neutral trim, muzzle scale. */
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
const browser = await chromium.launch({headless:false,args:['--enable-unsafe-webgpu','--enable-features=Vulkan','--disable-gpu-sandbox','--ignore-gpu-blocklist','--ozone-platform=x11']});
const errors=[];
try {
 const page=await browser.newPage({viewport:{width:1672,height:941}});
 page.on('pageerror',e=>errors.push(String(e)));
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 await page.goto(process.env.MIDWAY_URL || 'http://127.0.0.1:5199');
 await page.waitForSelector('#loading.hidden',{state:'attached',timeout:90000});
 await page.waitForSelector('#briefing:not(.hidden)');
 await page.evaluate(async()=>{const url=performance.getEntriesByType('resource').map(e=>e.name).findLast(n=>/\/src\/game\.ts(?:\?|$)/.test(n));if(!url)throw new Error('Missing loaded game module');window.midway=(await import(url)).default.scene;if(!window.midway)throw new Error('Loaded game has no scene');});
 const adapter=await page.evaluate(async()=>{const a=await navigator.gpu.requestAdapter();return {vendor:a.info.vendor,architecture:a.info.architecture};});
 assert.ok(adapter.vendor && !/swiftshader|lavapipe/i.test(JSON.stringify(adapter)),JSON.stringify(adapter));
 const snapshot=()=>page.evaluate(()=>{const s=window.midway,p=s.battle.player;return {mode:p.mode,pitch:p.pitch,vy:p.vy,speed:p.speed,stall:p.stall,y:p.y,time:s.battle.time,paused:s.paused,keys:[...s.keys],gear:p.gear,gearPos:p.gearPos};});
 const seconds=async(n)=>{const t=(await snapshot()).time;await page.waitForFunction(t=>window.midway.battle.time>=t,t+n,{timeout:Math.max(15000,n*4000)});};
 await mkdir('screenshots',{recursive:true});
 await page.screenshot({path:'screenshots/repair-briefing.png'});
 await page.click('#start-air');
 await seconds(1);
 const before=await snapshot();
 await page.keyboard.down('ArrowDown');await seconds(1);await page.keyboard.up('ArrowDown');
 const pulling=await snapshot();assert.ok(pulling.pitch>before.pitch+.01,JSON.stringify({before,pulling}));
 await seconds(30);
 const neutral=await snapshot();
 assert.equal(neutral.mode,'flight');assert.ok(Math.abs(neutral.vy)<3 && neutral.stall<.1 && neutral.speed>70,JSON.stringify(neutral));
 console.log('keyboard release',JSON.stringify({adapter,before,pulling,neutral}));
 await page.screenshot({path:'screenshots/repair-flight.png'});
 await page.keyboard.press('KeyC');await seconds(.2);
 await page.screenshot({path:'screenshots/repair-cockpit.png'});
 const cockpit=await page.evaluate(()=>{const r=window.midway.world.playerMesh;return {instruments:!!r.getObjectByName("Douglas live cockpit instruments")?.children.length,glass:[]};});assert.ok(cockpit.instruments,'live cockpit instruments');
 await page.keyboard.press('KeyC');await page.keyboard.press('KeyC');
 await page.keyboard.down('Space');
 await page.waitForFunction(()=>window.midway.world.particles.glow.items.some(p=>p.life<.06));
 const flashes=await page.evaluate(()=>window.midway.world.particles.glow.items.filter(p=>p.life<.06).map(p=>({size:p.size,life:p.life})));
 assert.ok(flashes.length && flashes.every(p=>p.size<.5 && p.life<.06),JSON.stringify(flashes));
 await page.screenshot({path:'screenshots/repair-guns.png'});
 await page.keyboard.up('Space');
 console.log('muzzle flashes',JSON.stringify(flashes));
 await page.keyboard.press('KeyB');await seconds(.2);
 assert.ok(await page.evaluate(()=>window.midway.battle.bombs.length>0),'bomb release creates a live projectile');
 // The mouse never steers: moving it, and clicking it, must leave elevator and aileron alone.
 const stick=()=>page.evaluate(()=>{const p=window.midway.battle.player;return {elevator:p.elevator,aileron:p.aileron,rollRate:p.rollRate??0};});
 await page.mouse.move(840,470);await page.mouse.move(300,180);await page.mouse.move(1400,830);await seconds(1);
 const moved=await stick();
 assert.ok(Math.abs(moved.elevator)<.02 && Math.abs(moved.aileron)<.02,'mouse movement must not command pitch or roll: '+JSON.stringify(moved));
 await page.mouse.click(300,700);await seconds(1);
 const clicked=await stick();
 assert.ok(Math.abs(clicked.elevator)<.02 && Math.abs(clicked.aileron)<.02,'left click must not command pitch or roll: '+JSON.stringify(clicked));
 assert.ok(await page.evaluate(()=>!('x'in window.midway.mouse)&&!('active'in window.midway.mouse)),'virtual mouse stick fields are gone');
 // Left button held fires the guns, exactly as Space does.
 await page.evaluate(()=>{window.midway.world.particles.glow.items.length=0;});
 await page.mouse.down();
 await page.waitForFunction(()=>window.midway.world.particles.glow.items.some(p=>p.life<.06),null,{timeout:10000});
 await page.mouse.up();
 assert.equal(await page.evaluate(()=>window.midway.mouse.fire),false,'button release stops the guns');
 // Right-button drag moves the view only.
 const look=await page.evaluate(()=>({yaw:window.midway.world.lookYaw||0,pitch:window.midway.world.lookPitch||0}));
 await page.mouse.move(840,470);await page.mouse.down({button:'right'});
 await page.mouse.move(1080,360);await page.mouse.move(1180,320);await seconds(.5);
 const dragging=await page.evaluate(()=>({yaw:window.midway.world.lookYaw||0,pitch:window.midway.world.lookPitch||0,active:window.midway.world.lookActive}));
 await page.mouse.up({button:'right'});
 assert.ok(dragging.active && Math.abs(dragging.yaw-look.yaw)>.05 && Math.abs(dragging.pitch-look.pitch)>.05,'right drag moves the camera look: '+JSON.stringify({look,dragging}));
 const afterDrag=await stick();
 assert.ok(Math.abs(afterDrag.elevator)<.02 && Math.abs(afterDrag.aileron)<.02,'right drag must not steer: '+JSON.stringify(afterDrag));
 // Keyboard is the only stick: Down raises the nose, release returns to neutral.
 await page.keyboard.down('ArrowDown');await seconds(.6);
 const keyPull=await stick();
 assert.ok(keyPull.elevator>.25,'ArrowDown pitches up: '+JSON.stringify(keyPull));
 await page.keyboard.up('ArrowDown');await seconds(1.5);
 const keyRelease=await stick();
 assert.ok(Math.abs(keyRelease.elevator)<.06,'releasing ArrowDown returns the stick to neutral: '+JSON.stringify(keyRelease));
 console.log('mouse never steers',JSON.stringify({moved,clicked,look,dragging,keyPull,keyRelease}));
 await page.keyboard.press('Escape');const paused=(await snapshot()).time;
 await page.waitForTimeout(200);assert.equal((await snapshot()).time,paused);
 for(const value of ['low','high','balanced']){await page.selectOption('#quality',value);await page.waitForTimeout(250);}
 await page.click('#restart-pause');await page.click('#start-deck');
 await page.keyboard.down('KeyW');await seconds(15);await page.keyboard.up('KeyW');
 await page.keyboard.down('ArrowDown');await seconds(1);await page.keyboard.up('ArrowDown');
 await seconds(10);
 const launch=await snapshot();assert.equal(launch.mode,'flight',JSON.stringify(launch));assert.ok(launch.y>25 && launch.stall<.1,JSON.stringify(launch));
 assert.equal(launch.gear,false,'automatic gear-up after safe positive climb');
 await page.keyboard.press('KeyG');await seconds(3.5);
 assert.equal((await snapshot()).gear,true,'manual gear override');
 await page.keyboard.press('KeyG');
 console.log('takeoff',JSON.stringify(launch));
 await page.screenshot({path:'screenshots/repair-takeoff.png'});
 await page.keyboard.press('Escape');await page.click('#restart-pause');
 for(const viewport of [{width:1024,height:768},{width:844,height:390}]){
  await page.setViewportSize(viewport);await page.waitForTimeout(300);
  assert.ok(await page.locator('#start-deck').isVisible());
  await page.screenshot({path:`screenshots/repair-${viewport.width}.png`});
 }
 assert.deepEqual(errors,[]);
 console.log('PASS: keyboard release, mouse never steers, click fires, right-drag look, bounded flashes, pause, quality, restart, takeoff, viewport captures; no console/GPU errors');
} finally {await browser.close();}
