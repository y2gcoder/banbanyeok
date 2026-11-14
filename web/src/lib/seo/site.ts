/**
 * 사이트 주소. 도메인이 정해지기 전이라 하드코딩하지 않고 환경 변수 `SITE_URL`에서 읽는다(없으면 localhost).
 *
 * `SITE_URL`은 **빌드 때** 정해진다: 정적으로 만든 페이지의 canonical·OG 주소가 빌드 결과에 들어가기 때문이다(P8이 배포 빌드에 넣는다).
 * 값이 없거나 localhost류이면 검색엔진 색인을 막는다(개발·미리보기 배포가 색인되지 않게, `isIndexableSite`).
 */
const DEFAULT_SITE_URL = "http://localhost:3000";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]);

type Env = Record<string, string | undefined>;

/** 끝의 `/`를 뗀 출처(origin). 경로·쿼리가 들어 있거나 http(s)가 아니면 오류(오타를 빌드에서 잡는다). */
export function siteUrl(env: Env = process.env): string {
  const raw = env.SITE_URL?.trim();
  if (!raw) return DEFAULT_SITE_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`SITE_URL이 URL이 아닙니다: ${raw}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`SITE_URL은 http(s)여야 합니다: ${raw}`);
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`SITE_URL은 경로 없이 출처만 적어 주세요(예: https://example.com): ${raw}`);
  }
  return url.origin;
}

/** 색인해도 되는 배포인가: `SITE_URL`이 명시되어 있고 localhost류가 아닐 때만 true. */
export function isIndexableSite(env: Env = process.env): boolean {
  if (!env.SITE_URL?.trim()) return false;
  return !LOCAL_HOSTS.has(new URL(siteUrl(env)).hostname);
}

/** `/meet/강남-홍대입구` 같은 경로를 절대 URL로. 한글은 퍼센트 인코딩된다. */
export function absoluteUrl(path: string, env: Env = process.env): string {
  return new URL(path, `${siteUrl(env)}/`).href;
}
