// 두 PNG의 크기와 픽셀 차이를 낸다(같은 글꼴·같은 그림이면 0). web/node_modules의 sharp를 쓴다.
//   node spikes/vinext/png-diff.mjs a.png b.png  →  {"a":[w,h],"b":[w,h],"diffPixels":n,"maxDelta":d}
import { createRequire } from "node:module";

const require = createRequire(new URL("../../web/package.json", import.meta.url));
const sharp = require("sharp");

const [a, b] = await Promise.all(
  process.argv.slice(2, 4).map((p) => sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true })),
);
const out = { a: [a.info.width, a.info.height], b: [b.info.width, b.info.height], diffPixels: null, maxDelta: null };
if (a.info.width === b.info.width && a.info.height === b.info.height) {
  let diff = 0;
  let max = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    let d = 0;
    for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(a.data[i + c] - b.data[i + c]));
    if (d > 0) diff++;
    max = Math.max(max, d);
  }
  out.diffPixels = diff;
  out.maxDelta = max;
}
console.log(JSON.stringify(out));
