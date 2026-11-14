/**
 * `/api/*` 같은 출처 프록시(Worker 진입점이 부른다). `/api/healthz` → `<origin>/healthz`, `/api/v1/*` → `<origin>/v1/*`.
 * 그 밖의 경로는 `null`(Next가 처리). 서버 오류·시간 초과는 계약의 오류 형식 `{code, message}`로 돌려준다.
 */
import { CLIENT_IP_HEADER, PROXY_SECRET_HEADER, upstreamHeaders } from "./headers";

export type ProxyConfig = {
  origin: string | undefined;
  secret: string | undefined;
  /** 서버 응답을 기다리는 최대 시간. Cloud Run 콜드스타트(수 초)를 넘기되 무한정은 아니게. */
  timeoutMs?: number;
  /** 서버 호출 함수(Worker에서는 전역 fetch). src 밖(worker.ts)이 넘겨 주어 서버 호출 출입구 규칙(ESLint)을 지킨다. */
  fetchImpl: (request: Request) => Promise<Response>;
};

const DEFAULT_TIMEOUT_MS = 15_000;

function errorResponse(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ code, message }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/** 프록시할 경로면 서버 쪽 경로(`/healthz`, `/v1/...`)를, 아니면 null. `..`·인코딩된 슬래시로 다른 경로를 만들 수 없다. */
export function upstreamPath(pathname: string): string | null {
  if (pathname === "/api/healthz") return "/healthz";
  if (pathname === "/api/v1" || pathname.startsWith("/api/v1/")) {
    const rest = pathname.slice("/api".length);
    if (rest.split("/").some((segment) => segment === ".." || segment === ".")) return null;
    return rest;
  }
  return null;
}

export async function proxyApiRequest(request: Request, config: ProxyConfig): Promise<Response | null> {
  const url = new URL(request.url);
  const path = upstreamPath(url.pathname);
  if (path === null) return null;

  const origin = config.origin?.trim().replace(/\/+$/, "");
  if (!origin) return errorResponse(503, "UPSTREAM_NOT_CONFIGURED", "서버 주소가 설정되지 않았어요.");

  const headers = upstreamHeaders(request.headers, {
    secret: config.secret,
    clientIp: request.headers.get("cf-connecting-ip"),
  });
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const upstream = new Request(`${origin}${path}${url.search}`, {
    method: request.method,
    headers,
    ...(hasBody ? { body: request.body, duplex: "half" } : {}),
    redirect: "manual",
    signal: AbortSignal.timeout(config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  } as RequestInit);

  try {
    const response = await config.fetchImpl(upstream);
    // 서버가 우리 신뢰 헤더를 되돌려 주는 일은 없어야 하지만, 응답 쪽에서도 지운다.
    const out = new Response(response.body, response);
    out.headers.delete(PROXY_SECRET_HEADER);
    out.headers.delete(CLIENT_IP_HEADER);
    out.headers.delete("set-cookie");
    return out;
  } catch (error) {
    if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
      return errorResponse(504, "UPSTREAM_TIMEOUT", "서버가 응답하지 않아요. 잠시 후 다시 시도해 주세요.");
    }
    return errorResponse(502, "UPSTREAM_UNAVAILABLE", "서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.");
  }
}
