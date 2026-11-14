/**
 * 사전 계산 파일을 읽는 **빌드 시** 로더(node:fs). SEO 페이지·사이트맵·next.config가 쓰며, 정적 생성 결과만 배포되므로
 * Workers 런타임에서는 실행되지 않는다(`dynamicParams = false`).
 *
 * 읽는 곳: 환경 변수 `SEO_PAIRS_FILE`(명시한 경로), 없으면 `../data/artifacts/dev/seo-pairs.json`.
 * 파일이 없으면 빌드를 멈춘다(개발용 표본으로 조용히 넘어가면 가짜 추천이 공개될 수 있다).
 *
 * 같은 폴더의 manifest.json이 `files.seoPages`를 가지면 바이트 수·sha256과 dataVersion을 대조한다(contracts/data-format.md §5 검증 ③).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildPairPages, type PairPage, type SkippedPair } from "./pair-pages";
import { parseSeoPairs } from "./pairs";

export type SeoSite = {
  dataVersion: string;
  pages: PairPage[];
  skipped: SkippedPair[];
};

type Env = Record<string, string | undefined>;

const DEFAULT_PATH = "../data/artifacts/dev/seo-pairs.json";

function locate(env: Env, cwd: string): string {
  const explicit = env.SEO_PAIRS_FILE?.trim();
  const path = resolve(cwd, explicit || DEFAULT_PATH);
  if (!existsSync(/* turbopackIgnore: true */ path)) {
    throw new Error(
      `seo-pairs.json을 찾을 수 없습니다: ${explicit || DEFAULT_PATH}. 파이프라인 산출물(data/artifacts/*/seo-pairs.json)을 두거나 SEO_PAIRS_FILE로 경로를 알려 주세요.`,
    );
  }
  return path;
}

/** manifest.json이 옆에 있고 seoPages를 적어 두었으면 파일과 대조한다. 어긋나면 오래된/바뀐 산출물이다. */
function verifyAgainstManifest(path: string, bytes: Buffer, dataVersion: string): void {
  const manifestPath = resolve(dirname(path), "manifest.json");
  if (!existsSync(/* turbopackIgnore: true */ manifestPath)) return;
  const manifest = JSON.parse(readFileSync(/* turbopackIgnore: true */ manifestPath, "utf8")) as {
    dataVersion?: string;
    files?: { seoPages?: { bytes?: number; sha256?: string } };
  };
  if (manifest.dataVersion && manifest.dataVersion !== dataVersion) {
    throw new Error(`seo-pairs.json(${dataVersion})과 manifest.json(${manifest.dataVersion})의 dataVersion이 다릅니다`);
  }
  const entry = manifest.files?.seoPages;
  if (!entry) return;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (entry.bytes !== bytes.length || entry.sha256 !== sha256) {
    throw new Error("seo-pairs.json이 manifest.json의 files.seoPages(바이트 수·sha256)와 다릅니다");
  }
}

let memo: { key: string; site: SeoSite } | null = null;

export function loadSeoSite(env: Env = process.env, cwd: string = process.cwd()): SeoSite {
  const path = locate(env, cwd);
  if (memo?.key === path) return memo.site;
  const bytes = readFileSync(/* turbopackIgnore: true */ path);
  const file = parseSeoPairs(bytes.toString("utf8"));
  verifyAgainstManifest(path, bytes, file.dataVersion);
  const { pages, skipped } = buildPairPages(file);
  const site: SeoSite = { dataVersion: file.dataVersion, pages, skipped };
  memo = { key: path, site };
  return site;
}
