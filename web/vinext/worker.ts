/**
 * vinext 비교 실험(#254)의 Worker 진입점. 운영 진입점(../worker.ts)과 같은 순서로 정식 도메인 리디렉트와 `/api/*` 프록시를 먼저 하고,
 * 나머지는 OpenNext 대신 vinext의 fetch handler로 넘긴다. cloudflare.config.ts의 entrypoint가 이 파일이다.
 */
import handler from "vinext/server/fetch-handler";
import { canonicalRedirect } from "../src/lib/proxy/canonical";
import { proxyApiRequest } from "../src/lib/proxy/proxy";

type Env = { API_ORIGIN?: string; PROXY_SHARED_SECRET?: string; CANONICAL_HOST?: string };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // vinext는 빌드 때 이 Worker를 루프백에서 띄워 모든 페이지와 `/__vinext/prerender/*`를 부른다(사전 렌더). CANONICAL_HOST가
    // 빌드 값이라 그 요청까지 정식 도메인으로 보내면 빌드 도구가 운영 주소를 따라가 읽고, 사전 렌더가 0건이 돼도 빌드는 성공한다.
    // OpenNext는 CANONICAL_HOST가 배포 때 값이라 이런 일이 없다. 운영 요청의 호스트는 루프백일 수 없으므로 루프백만 건너뛴다.
    const loopback = /^(127\.0\.0\.1|localhost|\[::1\])$/.test(new URL(request.url).hostname);
    const redirect = loopback ? null : canonicalRedirect(request, env.CANONICAL_HOST);
    if (redirect) return redirect;
    const proxied = await proxyApiRequest(request, {
      origin: env.API_ORIGIN,
      secret: env.PROXY_SHARED_SECRET,
      fetchImpl: (upstream) => fetch(upstream),
    });
    return proxied ?? handler.fetch(request, env, ctx);
  },
};
