/** Inspect supplied assets with the actual WebGPU renderer. Run through capture-lock.sh. */
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
const out=process.env.MIDWAY_SHOTS||'screenshots/asset-polish';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:false,args:['--enable-unsafe-webgpu','--enable-features=Vulkan','--disable-gpu-sandbox','--ignore-gpu-blocklist','--ozone-platform=x11']});
const errors=[];
try {
 const page=await browser.newPage({viewport:{width:1440,height:960}});
 page.on('pageerror',e=>errors.push(String(e)));
 page.on('console',m=>{if(m.type()==='error'&&!m.location().url.endsWith('/favicon.ico'))errors.push(m.location().url+' '+m.text())});
 page.on('response',r=>{if(r.status()>=400)console.log('HTTP',r.status(),r.url())});
 await page.goto((process.env.MIDWAY_URL||'http://127.0.0.1:5387')+'/tools/asset-viewer.html');
 await page.waitForFunction(()=>window.assetReview?.ready,{},{timeout:120000});
 const adapter=await page.evaluate(async()=>{const a=await navigator.gpu.requestAdapter();return {vendor:a.info.vendor,architecture:a.info.architecture}});
 assert(adapter.vendor&&!/swiftshader|lavapipe/i.test(JSON.stringify(adapter)),JSON.stringify(adapter));
 console.log('WebGPU',adapter);
 const files=await page.evaluate(()=>window.assetReview.files);
 for(const name of files){
  const info=await page.evaluate(async name=>{const r=window.assetReview;r.paused=true;return r.load(name)},name);
  assert(info.triangles>0&&info.size.every(n=>n>0&&Number.isFinite(n)),name+' invalid geometry');
  assert(info.textures>0,name+' missing textures');
  await page.waitForTimeout(500);
  await page.screenshot({path:`${out}/${name}.png`});
  console.log(JSON.stringify(info));
  if(/aircraft\.|torpedo|yorktown/.test(name)){
   await page.evaluate(()=>window.assetReview.view('top'));
   await page.waitForTimeout(150);await page.screenshot({path:`${out}/${name}-top.png`});
  }
  for(const clip of info.clips){
   const moved=await page.evaluate(clip=>{
    const r=window.assetReview;r.animate('');r.model.updateMatrixWorld(true);
    const rest=new Map();r.model.traverse(n=>rest.set(n.uuid,n.matrixWorld.clone()));
    r.animate(clip);r.mixer.setTime(r.mixer._actions.find(a=>a.getClip().name===clip).getClip().duration*.65);r.model.updateMatrixWorld(true);
    let changed=false;r.model.traverse(n=>{if(!n.matrixWorld.equals(rest.get(n.uuid)))changed=true});return changed;
   },clip);
   assert(moved,name+' '+clip+' does not move any node');
   await page.evaluate(()=>window.assetReview.view());
   await page.waitForTimeout(150);await page.screenshot({path:`${out}/${name}-${clip}.png`});
  }
 }
 assert.deepEqual(errors,[],'renderer errors');
 console.log('PASS: all supplied assets load with textures; every clip moves nodes; captures saved to '+out);
}finally{await browser.close()}
