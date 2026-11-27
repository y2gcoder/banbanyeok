/**
 * 서버 호출은 이 모듈로만 한다(dependency-cruiser와 ESLint가 다른 곳의 openapi-fetch·fetch를 막는다).
 * 웹은 추천을 직접 계산하지 않는다. 계약 원본은 contracts/openapi.yaml.
 */
import createClient from "openapi-fetch";
import { SYNTHETIC_HEADER, withTrustHeaders } from "@/lib/proxy/headers";
import { apiBaseUrl, HEALTHZ_PATH } from "./config";
import type { paths } from "./schema.gen";
import type { ApiError, Mode, RecommendBody, RecommendResult, TimeSlotId } from "./types";

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

/**
 * 이 웹이 읽을 줄 아는 추가 막차 분류(openapi `lastTrainKinds`). 출발 예정(`scheduled`)은 `lib/result/last-train.ts`가 줄에만 보이고
 * 요약·공유 그림에서 뺀다. 이 값을 보내지 않는 옛 웹에는 서버가 그 칸을 확인 필요로 준다(ADR-0010). 막차를 싣는 요청은 모두 보낸다.
 */
export const LAST_TRAIN_KINDS = "scheduled";

/** openapi-fetch 클라이언트(이 폴더 안에서만 쓴다). */
export function client(headers?: Headers) {
  return createClient<paths>({ baseUrl: apiBaseUrl(), ...(headers ? { headers } : {}) });
}

/**
 * 서버 컴포넌트·라우트가 서버(Cloud Run)를 직접 부를 때 붙이는 신뢰 헤더(비밀 + 방문자 IP). 브라우저의 `/api/*` 호출은
 * Worker 프록시(worker.ts)가 같은 규칙으로 붙이므로 여기서는 하지 않는다. 비밀이 없거나(로컬) 요청 문맥이 없으면 붙이지 않는다.
 */
export async function trustedServerHeaders(): Promise<Headers | undefined> {
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

/**
 * 추천에 필요한 상태. 별칭은 서버가 표시 이름(label)과 문장에 쓴다. 구분(timeSlot)이 계산 기준을 정한다.
 * `lib/api`는 링크 코덱(`lib/link`)을 모르는 잎이다: 링크가 담는 상태(`ShareState`)가 이 모양을 채우는지는 `lib/link/codec.test.ts`가 타입으로 확인한다.
 * `slotDefaulted`의 뜻은 `ShareState`에 적혀 있다(옛 링크라 구분을 고른 적이 없을 때만 true).
 */
export type RecommendQuery = {
  origins: string[];
  mode: Mode;
  favorIndex: number | null;
  nicknames: (string | null)[] | null;
  timeSlot: TimeSlotId;
  slotDefaulted?: true;
};

/**
 * `POST /recommend` 본문. favorIndex는 배려 모드일 때만 보낸다. 별칭은 사람이 넣은 것만 보낸다: 넣지 않은 사람은 `null`,
 * 아무도 넣지 않았으면 필드를 생략한다. 구분은 고른 것이면 늘 보낸다(서버 기본값도 평일 낮이지만 요청이 기준을 스스로 말하게).
 * 옛 링크(v=1)처럼 구분을 고른 적이 없으면(`slotDefaulted`) 보내지 않는다: 순위는 평일 낮으로 같고, 서버는 요일을 모르는 요청에
 * 귀갓길 막차 시각을 내지 않는다(`lastTrainBasis.unavailable = day_unknown`).
 */
export function recommendBody(query: RecommendQuery): RecommendBody {
  const nicknames = query.origins.map((_, i) => query.nicknames?.[i]?.trim() || null);
  return {
    origins: query.origins,
    mode: query.mode,
    ...(query.mode === "favor" && query.favorIndex !== null ? { favorIndex: query.favorIndex } : {}),
    ...(nicknames.some((name) => name !== null) ? { nicknames } : {}),
    ...(query.slotDefaulted ? {} : { timeSlot: query.timeSlot }),
  };
}

export async function recommend(
  query: RecommendQuery,
  signal?: AbortSignal,
  purpose?: "preview",
): Promise<RecommendResult> {
  const body = recommendBody(query);
  const result = await client(await trustedServerHeaders()).POST("/recommend", {
    params: { query: { lastTrainKinds: LAST_TRAIN_KINDS } },
    body,
    ...(purpose === "preview" ? { headers: { [SYNTHETIC_HEADER]: "1" } } : {}),
    cache: "no-store",
    ...(signal ? { signal } : {}),
  });
  if (result.data !== undefined) return result.data;
  throw failure(result.response.status, result.error);
}

/**
 * 응답이 오류이면 계약의 오류 모양을 [ApiRequestError]로 던진다. 오류 본문이 없으면 HTTP 상태로 만든다.
 * 새 서버는 `application/problem+json`(`{type, title, status, detail, code}`)을 준다
 * (openapi-fetch는 Content-Type과 상관없이 JSON 본문을 파싱한다). 사람에게 보이는 문구는 `detail`, 분기는 `code`다.
 */
export function failure(status: number, error: ApiError | string | undefined): ApiRequestError {
  // 프록시·CDN이 준 빈 본문·HTML(JSON이 아닌 본문은 openapi-fetch가 문자열로 준다)은 계약의 오류 모양이 아니다.
  if (error !== undefined && typeof error === "object" && typeof error.code === "string") {
    return new ApiRequestError(status, error.code, typeof error.detail === "string" ? error.detail : "");
  }
  return new ApiRequestError(status, "UNKNOWN", `HTTP ${status}`);
}

/** 입력 화면을 열 때 서버를 미리 깨운다(Cloud Run min 0 콜드스타트를 입력 시간 뒤로 숨긴다). 실패해도 무시한다. */
export async function warmUpServer(): Promise<void> {
  try {
    await fetch(HEALTHZ_PATH, { cache: "no-store", keepalive: true });
  } catch {
    // 미리 깨우기는 최선 노력이다. 실제 요청이 다시 시도한다.
  }
}
