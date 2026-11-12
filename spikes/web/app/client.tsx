"use client";
import { useState } from 'react';
import { rankFair } from 'fair-core';
export default function Client() {
  const [result, setResult] = useState('pending');
  return <><button onClick={() => setResult(rankFair(['CCC','BBB','AAA'], [new Int32Array([30,20,20]),new Int32Array([10,20,20])]).join(','))}>계산</button><output id="client">{result}</output></>;
}
