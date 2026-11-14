/**
 * 정식 도메인이 정해지면(`CANONICAL_HOST`) 그 밖의 호스트(workers.dev 등)로 온 요청을 정식 주소로 영구 이동시킨다.
 * 비어 있으면(도메인 붙이기 전) 아무것도 하지 않는다. 메서드·본문이 유지되는 308을 쓴다.
 */
export function canonicalRedirect(request: Request, canonicalHost: string | undefined): Response | null {
  const host = canonicalHost?.trim().toLowerCase();
  if (!host) return null;
  const url = new URL(request.url);
  if (url.hostname === host) return null;
  return new Response(null, {
    status: request.method === "GET" || request.method === "HEAD" ? 301 : 308,
    headers: { location: `https://${host}${url.pathname}${url.search}`, "cache-control": "public, max-age=3600" },
  });
}
