/**
 * 웹 → 서버 요청에 붙이는 신뢰 헤더 규칙(프록시와 서버 컴포넌트 호출이 함께 쓴다).
 *
 * - `X-Banbanyeok-Proxy-Secret`: Worker secret `PROXY_SHARED_SECRET`. 서버는 이 값이 맞을 때만 아래 IP를 믿는다.
 * - `X-Banbanyeok-Client-IP`: Cloudflare가 붙인 `CF-Connecting-IP`. 레이트 리밋 키.
 *
 * 브라우저(또는 누구든)가 같은 이름의 헤더를 보내도 **먼저 모두 지우고** 우리가 다시 쓴다. 비밀이 없으면 둘 다 보내지 않는다
 * (IP만 보내면 서버가 믿을 근거가 없다).
 */
export const PROXY_SECRET_HEADER = "x-banbanyeok-proxy-secret";
export const CLIENT_IP_HEADER = "x-banbanyeok-client-ip";

/** 서버로 넘기지 않는 요청 헤더: 홉 간 헤더, 쿠키(이 서비스는 쿠키를 쓰지 않는다), 프록시 체인·Cloudflare 내부 헤더. */
const DROPPED_EXACT = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-length",
  "cookie",
  "x-real-ip",
  "forwarded",
  "true-client-ip",
]);
const DROPPED_PREFIXES = ["cf-", "x-forwarded-", "x-banbanyeok-", "x-vercel-", "x-middleware-"];

export type TrustedEnv = { secret: string | undefined; clientIp: string | null };

/** 들어온 요청 헤더에서 서버로 보낼 헤더를 만든다. */
export function upstreamHeaders(incoming: Headers, trusted: TrustedEnv): Headers {
  const out = new Headers();
  incoming.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (DROPPED_EXACT.has(lower)) return;
    if (DROPPED_PREFIXES.some((prefix) => lower.startsWith(prefix))) return;
    out.set(name, value);
  });
  return withTrustHeaders(out, trusted);
}

/** 이미 만든 헤더(서버 컴포넌트 호출 등)에 신뢰 헤더를 덧쓴다. 같은 이름이 있으면 지우고 다시 쓴다. */
export function withTrustHeaders(headers: Headers, { secret, clientIp }: TrustedEnv): Headers {
  headers.delete(PROXY_SECRET_HEADER);
  headers.delete(CLIENT_IP_HEADER);
  // IP를 모르면(로컬 개발 등) 비밀도 보내지 않는다: 서버가 소켓 주소를 쓰게 한다.
  const ip = clientIp?.trim();
  if (secret && ip) {
    headers.set(PROXY_SECRET_HEADER, secret);
    headers.set(CLIENT_IP_HEADER, ip);
  }
  return headers;
}
