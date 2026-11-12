import {writeFileSync} from 'node:fs';
const root=process.env.URL || 'http://localhost:18787';
const output=[];
for(const full of [false,true]) {
 const rows=[];
 for(let i=0;i<6;i++) {
  const start=performance.now();
  const r=await fetch(`${root}/og${full?'?full=1':''}`);
  const b=Buffer.from(await r.arrayBuffer());
  if(r.status!==200||b.subarray(1,4).toString()!=='PNG') throw new Error(`OG failed: ${r.status} ${b.toString().slice(0,200)}`);
  rows.push({wall_ms:+(performance.now()-start).toFixed(2),server_timing:r.headers.get('server-timing'),bytes:b.length});
  if(i===0) writeFileSync(`../results/og-${full?'full':'subset'}.png`,b);
 }
 output.push({font:full?'full':'subset',first:rows[0],warm:rows.slice(1),mean_warm_wall_ms:rows.slice(1).reduce((s,r)=>s+r.wall_ms,0)/5});
}
writeFileSync('../results/og-timing.json',JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify(output,null,2));
