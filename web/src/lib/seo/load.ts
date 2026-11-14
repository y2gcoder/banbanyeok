/**
 * 사전 계산 파일을 읽는 **빌드 시** 로더(node:fs). SEO 페이지·사이트맵·next.config가 쓰며, 정적 생성 결과만 배포되므로
 * Workers 런타임에서는 실행되지 않는다(`dynamicParams = false`).
 *
 * 읽는 순서
 *  1. 환경 변수 `SEO_PAIRS_FILE`(명시한 경로. 없으면 오류)
 *  2. `../data/artifacts/dev/seo-pairs.json`(파이프라인 산출물이 저장소에 있을 때)
 *  3. `fixtures/seo-pairs.json`(개발용 작은 표본). 이 경우 `source = "fixture"`이며 색인·사이트맵에서 빠진다.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildPairPages, type PairPage, type SkippedPair } from "./pair-pages.ts";
import { parseSeoPairs } from "./pairs.ts";

type SeoSource = "artifact" | "fixture";

export type SeoSite = {
  source: SeoSource;
  dataVersion: string;
  pages: PairPage[];
  skipped: SkippedPair[];
};

type Env = Record<string, string | undefined>;

function locate(env: Env, cwd: string): { path: string; source: SeoSource } {
  const explicit = env.SEO_PAIRS_FILE?.trim();
  if (explicit) {
    const path = resolve(cwd, explicit);
    if (!existsSync(/* turbopackIgnore: true */ path))
      throw new Error(`SEO_PAIRS_FILE을 찾을 수 없습니다: ${explicit}`);
    return { path, source: "artifact" };
  }
  const artifact = resolve(cwd, "../data/artifacts/dev/seo-pairs.json");
  if (existsSync(/* turbopackIgnore: true */ artifact)) return { path: artifact, source: "artifact" };
  return { path: resolve(cwd, "fixtures/seo-pairs.json"), source: "fixture" };
}

/** 같은 폴더의 manifest.json과 dataVersion이 다르면 경고한다(오래된 산출물을 섞어 쓴 것일 수 있다). */
function warnIfStale(path: string, dataVersion: string): void {
  const manifestPath = resolve(dirname(path), "manifest.json");
  if (!existsSync(/* turbopackIgnore: true */ manifestPath)) return;
  const manifest = JSON.parse(readFileSync(/* turbopackIgnore: true */ manifestPath, "utf8")) as {
    dataVersion?: string;
  };
  if (manifest.dataVersion && manifest.dataVersion !== dataVersion) {
    console.warn(`seo-pairs.json(${dataVersion})과 manifest.json(${manifest.dataVersion})의 dataVersion이 다릅니다`);
  }
}

let memo: { key: string; site: SeoSite } | null = null;

export function loadSeoSite(env: Env = process.env, cwd: string = process.cwd()): SeoSite {
  const { path, source } = locate(env, cwd);
  if (memo?.key === path) return memo.site;
  const file = parseSeoPairs(readFileSync(/* turbopackIgnore: true */ path, "utf8"));
  if (source === "artifact") warnIfStale(path, file.dataVersion);
  const { pages, skipped } = buildPairPages(file);
  if (source === "fixture")
    console.warn("seo-pairs.json이 없어 개발용 표본(fixtures/seo-pairs.json)을 씁니다. 색인하지 않습니다.");
  const site: SeoSite = { source, dataVersion: file.dataVersion, pages, skipped };
  memo = { key: path, site };
  return site;
}
