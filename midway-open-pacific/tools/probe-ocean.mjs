/** Measure the actual ocean owner, so this probe cannot keep a discarded spectrum alive. */
import assert from "node:assert/strict";
import { build } from "esbuild";
const {outputFiles}=await build({entryPoints:["src/render/ocean.ts"],bundle:true,platform:"node",format:"esm",write:false});
const {oceanSwell}=await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
let lo=Infinity,hi=-Infinity,sum=0,sum2=0,n=0;
for(let i=0;i<240;i++)for(let j=0;j<240;j++){
 const h=oceanSwell(i*3.1,j*3.7,12.5);lo=Math.min(lo,h);hi=Math.max(hi,h);sum+=h;sum2+=h*h;n++;
}
const sigma=Math.sqrt(sum2/n-(sum/n)**2),hs=4*sigma;
assert.ok(hs>.9&&hs<1.3,`reference sea state should produce Hs near 1.14m, got ${hs}`);
console.log(`Pacific fluid-lab swell: ${lo.toFixed(3)}..${hi.toFixed(3)} m; Hs ${(hs).toFixed(2)} m`);
