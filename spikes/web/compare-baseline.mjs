// Run after the Kotlin-backed builds. Restores sources even when the build fails.
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const paths=['app/client.tsx','app/page.tsx'];
const original=paths.map(p=>readFileSync(p,'utf8'));
try {
 for(let i=0;i<paths.length;i++) writeFileSync(paths[i],original[i].replace("import { rankFair } from 'fair-core';", "const rankFair = (_ids: string[], _times: Int32Array[]) => ['AAA', 'BBB', 'CCC'];"));
 for(const bundler of ['turbo','webpack']) {
   const args=['next','build',...(bundler==='webpack'?['--webpack']:[])];
   execFileSync('npx',args,{stdio:['ignore', 'pipe','pipe']});
   execFileSync('node',['measure-bundles.mjs',`${bundler}-baseline`],{stdio:'inherit'});
 }
} finally { paths.forEach((p,i)=>writeFileSync(p,original[i])); }
