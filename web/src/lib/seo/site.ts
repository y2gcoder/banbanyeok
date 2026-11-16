/**
 * 사이트 주소. 도메인이 정해지기 전이라 하드코딩하지 않고 환경 변수 `SITE_URL`에서 읽는다(없으면 localhost).
 *
 * `SITE_URL`·`SITE_NOINDEX`는 **빌드 때** 정해진다: 정적 페이지의 canonical·OG 주소가 빌드 결과에 들어가고, 요청 때 렌더되는 페이지
 * (`/s`, `/r/[방 ID]`, `/result`)도 같은 값을 쓰도록 `next.config.ts`의 `env`가 빌드 값을 번들에 박는다([siteEnv]).
 * Worker 런타임 환경에는 이 값이 없다(V1: 런타임 페이지의 og:image가 localhost로 나가 카카오 미리보기 그림이 비었다).
 * 값이 없거나 localhost류이면 검색엔진 색인을 막는다(개발·미리보기 배포가 색인되지 않게, `isIndexableSite`).
 */
const DEFAULT_SITE_URL = "http://localhost:3000";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]);

type Env = Record<string, string | undefined>;

/**
 * 빌드 때 박힌 사이트 설정. `process.env.SITE_URL`처럼 **이름을 그대로 적어야** 빌드가 값으로 바꿔 넣는다
 * (`process.env`를 통째로 넘기면 런타임 환경을 읽게 되어 Worker에서는 비어 있다).
 */
export function siteEnv(): Env {
  return { SITE_URL: process.env.SITE_URL, SITE_NOINDEX: process.env.SITE_NOINDEX };
}

function isTruthy(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() ?? "");
}

/** HTTPS 정식 주소가 있는가(HSTS를 켜도 되는 배포). `SITE_NOINDEX` 배포(workers.dev 단계)에서는 켜지 않는다. */
export function isHttpsCanonicalSite(env: Env = siteEnv()): boolean {
  return isIndexableSite(env) && new URL(siteUrl(env)).protocol === "https:";
}

/** 끝의 `/`를 뗀 출처(origin). 경로·쿼리가 들어 있거나 http(s)가 아니면 오류(오타를 빌드에서 잡는다). */
export function siteUrl(env: Env = siteEnv()): string {
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

/**
 * 색인해도 되는 배포인가: `SITE_URL`이 명시되어 있고 localhost류가 아니며 `SITE_NOINDEX`가 켜져 있지 않을 때만 true.
 * `SITE_NOINDEX=1`은 workers.dev 단계처럼 주소(canonical·OG)는 실제 값이어야 하지만 검색에는 노출하지 않을 때 쓴다.
 */
export function isIndexableSite(env: Env = siteEnv()): boolean {
  if (!env.SITE_URL?.trim()) return false;
  if (isTruthy(env.SITE_NOINDEX)) return false;
  return !LOCAL_HOSTS.has(new URL(siteUrl(env)).hostname);
}

/** `/meet/강남-홍대입구` 같은 경로를 절대 URL로. 한글은 퍼센트 인코딩된다. */
export function absoluteUrl(path: string, env: Env = siteEnv()): string {
  return new URL(path, `${siteUrl(env)}/`).href;
}
