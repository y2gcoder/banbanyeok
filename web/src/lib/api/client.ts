/**
 * 서버 호출은 이 모듈로만 한다(dependency-cruiser와 ESLint가 다른 곳의 openapi-fetch·fetch를 막는다).
 * 웹은 추천을 직접 계산하지 않는다. 계약 원본은 contracts/openapi.yaml.
 */
import createClient from "openapi-fetch";
import type { ShareState } from "@/lib/link/codec";
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

function client() {
  return createClient<paths>({ baseUrl: apiBaseUrl() });
}

/** 추천에 필요한 상태(별칭은 서버로 보내지 않는다). */
export type RecommendQuery = Pick<ShareState, "origins" | "mode" | "favorIndex">;

/** `POST /recommend` 본문. favorIndex는 배려 모드일 때만 보낸다. */
export function recommendBody(query: RecommendQuery): RecommendBody {
  return query.mode === "favor" && query.favorIndex !== null
    ? { origins: query.origins, mode: query.mode, favorIndex: query.favorIndex }
    : { origins: query.origins, mode: query.mode };
}

export async function recommend(query: RecommendQuery, signal?: AbortSignal): Promise<RecommendResult> {
  const body = recommendBody(query);
  const result = await client().POST("/recommend", {
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
