import { rankFair } from 'fair-core';
import Client from './client';
export const dynamic = 'force-dynamic';
export default function Page() {
  const result = rankFair(['CCC','BBB','AAA'],[new Int32Array([30,20,20]),new Int32Array([10,20,20])]);
  return <main><h1>반반역 스파이크</h1><p id="server">{result.join(',')}</p><Client /></main>;
}
