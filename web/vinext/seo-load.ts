/**
 * vinext 빌드에서만 `@/lib/seo/load`를 이 파일로 바꾼다(vite.config.ts alias, `VINEXT_SEO_BUNDLE=1`일 때).
 * vinext 1.4.6의 Static Assets 사전 렌더는 sitemap.ts와 force-static Route Handler(조합 그림)를 빌드 때 만들지 않아 Worker가
 * 요청 때 그린다. 그때는 node:fs로 저장소 파일을 읽을 수 없으므로, 같은 파일을 빌드 때 번들에 넣어 같은 결과를 내게 한다.
 * 바이트 수·sha256·dataVersion 대조는 src/lib/seo/load.ts와 같다.
 */
import { createHash } from "node:crypto";
import manifestText from "../../data/artifacts/dev/manifest.json?raw";
import pairsText from "../../data/artifacts/dev/seo-pairs.json?raw";
import { buildPairPages, type PairPage, type SkippedPair } from "../src/lib/seo/pair-pages";
import { parseSeoPairs } from "../src/lib/seo/pairs";

export type SeoSite = { dataVersion: string; pages: PairPage[]; skipped: SkippedPair[] };

let memo: SeoSite | null = null;

export function loadSeoSite(): SeoSite {
  if (memo) return memo;
  const file = parseSeoPairs(pairsText);
  const manifest = JSON.parse(manifestText) as {
    dataVersion?: string;
    files?: { seoPages?: { bytes?: number; sha256?: string } };
  };
  if (manifest.dataVersion && manifest.dataVersion !== file.dataVersion) {
    throw new Error(
      `seo-pairs.json(${file.dataVersion})과 manifest.json(${manifest.dataVersion})의 dataVersion이 다릅니다`,
    );
  }
  const bytes = new TextEncoder().encode(pairsText);
  const entry = manifest.files?.seoPages;
  if (entry && (entry.bytes !== bytes.length || entry.sha256 !== createHash("sha256").update(bytes).digest("hex"))) {
    throw new Error("seo-pairs.json이 manifest.json의 files.seoPages(바이트 수·sha256)와 다릅니다");
  }
  const { pages, skipped } = buildPairPages(file);
  memo = { dataVersion: file.dataVersion, pages, skipped };
  return memo;
}
