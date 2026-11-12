import {readdirSync,readFileSync,statSync,writeFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
function walk(p){return readdirSync(p).flatMap(n=>statSync(`${p}/${n}`).isDirectory()?walk(`${p}/${n}`):[`${p}/${n}`])}
const files=walk('.next/static').filter(n=>n.endsWith('.js'));
const result={files:files.length,raw:files.reduce((n,f)=>n+statSync(f).size,0),gzip:files.reduce((n,f)=>n+gzipSync(readFileSync(f)).length,0)};
writeFileSync(`../results/bundle-${process.argv[2]}.json`,JSON.stringify(result,null,2)+'\n');console.log(result);
