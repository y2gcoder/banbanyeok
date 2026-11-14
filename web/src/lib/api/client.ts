/**
 * 서버 호출은 이 모듈로만 한다(dependency-cruiser와 ESLint가 다른 곳의 openapi-fetch·fetch를 막는다).
 * 웹은 추천을 직접 계산하지 않는다. 계약 원본은 contracts/openapi.yaml.
 */
import createClient from "openapi-fetch";
import type { ShareState } from "@/lib/link/codec";
import { withTrustHeaders } from "@/lib/proxy/headers";
import { apiBaseUrl, HEALTHZ_PATH } from "./config";
import type { paths } from "./schema.gen";
import type { ApiError, RecommendBody, RecommendResult } from "./types";

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

function client(headers?: Headers) {
  return createClient<paths>({ baseUrl: apiBaseUrl(), ...(headers ? { headers } : {}) });
}

/**
 * 서버 컴포넌트·라우트가 서버(Cloud Run)를 직접 부를 때 붙이는 신뢰 헤더(비밀 + 방문자 IP). 브라우저의 `/api/*` 호출은
 * Worker 프록시(worker.ts)가 같은 규칙으로 붙이므로 여기서는 하지 않는다. 비밀이 없거나(로컬) 요청 문맥이 없으면 붙이지 않는다.
 */
async function trustedServerHeaders(): Promise<Headers | undefined> {
  if (typeof window !== "undefined") return undefined;
  const secret = process.env.PROXY_SHARED_SECRET;
  if (!secret) return undefined;
  try {
    const { headers } = await import("next/headers");
    const incoming = await headers();
    return withTrustHeaders(new Headers(), { secret, clientIp: incoming.get("cf-connecting-ip") });
  } catch {
    return undefined; // 요청 문맥 밖(빌드 등)
  }
}

/** 추천에 필요한 상태. 별칭은 서버가 표시 이름(label)과 문장에 쓴다. */
export type RecommendQuery = Pick<ShareState, "origins" | "mode" | "favorIndex" | "nicknames">;

/**
 * `POST /recommend` 본문. favorIndex는 배려 모드일 때만 보낸다. 별칭은 사람이 넣은 것만 보낸다: 넣지 않은 사람은 `null`,
 * 아무도 넣지 않았으면 필드를 생략한다.
 */
export function recommendBody(query: RecommendQuery): RecommendBody {
  const nicknames = query.origins.map((_, i) => query.nicknames?.[i]?.trim() || null);
  return {
    origins: query.origins,
    mode: query.mode,
    ...(query.mode === "favor" && query.favorIndex !== null ? { favorIndex: query.favorIndex } : {}),
    ...(nicknames.some((name) => name !== null) ? { nicknames } : {}),
  };
}

export async function recommend(query: RecommendQuery, signal?: AbortSignal): Promise<RecommendResult> {
  const body = recommendBody(query);
  const result = await client(await trustedServerHeaders()).POST("/recommend", {
    body,
    cache: "no-store",
    ...(signal ? { signal } : {}),
  });
  const { status } = result.response;
  if (result.data !== undefined) return result.data;
  const detail: ApiError = result.error ?? { code: "UNKNOWN", message: `HTTP ${status}` };
  throw new ApiRequestError(status, detail.code, detail.message);
}

/** 입력 화면을 열 때 서버를 미리 깨운다(Cloud Run min 0 콜드스타트를 입력 시간 뒤로 숨긴다). 실패해도 무시한다. */
export async function warmUpServer(): Promise<void> {
  try {
    await fetch(HEALTHZ_PATH, { cache: "no-store", keepalive: true });
  } catch {
    // 미리 깨우기는 최선 노력이다. 실제 요청이 다시 시도한다.
  }
}
