import assert from 'node:assert/strict';
import {rankFair} from './build/dist/js/productionLibrary/fair-core.mjs';
import {spawnSync} from 'node:child_process';
const oracle = spawnSync('python3',['-B','-c',`import json, sys
sys.path.insert(0,'../../prototype')
from algorithm import recommend
cases=json.load(open('../../prototype/scenarios.json'))
print(json.dumps([{'ids':c['input']['candidates'],'times':c['input']['times'],'expected':[r['stationId'] for r in recommend(**c['input'])['recommendations']]} for c in cases if c['input'].get('mode','fair')=='fair' and c['input'].get('tolerance',0)==0 and all(t is not None for row in c['input']['times'] for t in row)]))`],{encoding:'utf8'});
assert.equal(oracle.status,0,oracle.stderr);
const cases=JSON.parse(oracle.stdout);
for(const c of cases) assert.deepEqual(rankFair(c.ids,c.times.map(row=>Int32Array.from(row))),c.expected);
assert.deepEqual(rankFair(['CCC','BBB','AAA'],[Int32Array.from([30,20,20]),Int32Array.from([10,20,20])]),['AAA','BBB','CCC']);
console.log(`${cases.length} fair zero-tolerance reachable golden cases + ID tie passed`);
