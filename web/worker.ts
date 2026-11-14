/**
 * Cloudflare Worker 진입점. `/api/*`는 Next를 거치지 않고 여기서 바로 서버(Cloud Run)로 프록시한다(요청당 CPU 최소화,
 * 신뢰 헤더 규칙은 src/lib/proxy). 나머지는 OpenNext가 만든 Worker로 넘긴다. wrangler.jsonc `main`이 이 파일이다.
 */

// @ts-expect-error: `pnpm cf:build`가 만드는 파일이다(빌드 전에는 없고, 있어도 타입 선언이 없다).
import openNext from "./.open-next/worker.js";
import { canonicalRedirect } from "./src/lib/proxy/canonical";
import { proxyApiRequest } from "./src/lib/proxy/proxy";

// OpenNext가 쓰는 Durable Object 클래스는 이 진입점에서도 내보내야 한다(wrangler.jsonc는 바인딩하지 않지만 템플릿과 같게 둔다).
// @ts-expect-error: 위와 같은 이유
export { BucketCachePurge, DOQueueHandler, DOShardedTagCache } from "./.open-next/worker.js";

type Env = { API_ORIGIN?: string; PROXY_SHARED_SECRET?: string; CANONICAL_HOST?: string };
type Handler = { fetch(request: Request, env: Env, ctx: unknown): Promise<Response> };

export default {
  async fetch(request: Request, env: Env, ctx: unknown): Promise<Response> {
    const redirect = canonicalRedirect(request, env.CANONICAL_HOST);
    if (redirect) return redirect;
    const proxied = await proxyApiRequest(request, {
      origin: env.API_ORIGIN,
      secret: env.PROXY_SHARED_SECRET,
      fetchImpl: (upstream) => fetch(upstream),
    });
    return proxied ?? (openNext as Handler).fetch(request, env, ctx);
  },
} satisfies Handler;
