/**
 * API 주소. 브라우저는 같은 출처 rewrite(`/api/*` → 서버, next.config.ts)를 쓰고,
 * 서버 컴포넌트는 서버 주소로 바로 호출한다.
 *
 * - `API_ORIGIN`: 서버 출처(예: http://localhost:8080). 없으면 `SERVER_PORT`(scripts/dev-env.sh)로 로컬 주소를 만든다.
 * - mock 모드(`mise run dev:web:mock`)는 scripts/dev.ts가 가짜 서버를 띄우고 API_ORIGIN을 채운다.
 */
export function apiOrigin(env: Record<string, string | undefined> = process.env): string {
  const explicit = env.API_ORIGIN?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  return `http://localhost:${env.SERVER_PORT?.trim() || "8080"}`;
}

/** 계약의 servers.url(`/v1`)을 붙인 기준 주소. 브라우저에서는 rewrite 경로. */
export function apiBaseUrl(): string {
  return typeof window === "undefined" ? `${apiOrigin()}/v1` : "/api/v1";
}

export const HEALTHZ_PATH = "/api/healthz";
