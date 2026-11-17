import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";
import { analyticsConfig } from "./src/lib/analytics/config";
import { apiOrigin } from "./src/lib/api/config";
import { securityHeaders } from "./src/lib/security/headers";
import { isHttpsCanonicalSite } from "./src/lib/seo/site";
import { publicKakaoJsKey } from "./src/lib/share/kakao";

const origin = apiOrigin();
const analytics = analyticsConfig({
  key: process.env.NEXT_PUBLIC_POSTHOG_KEY,
  host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 사이트 주소는 빌드 값으로 번들에 박는다(src/lib/seo/site.ts `siteEnv`). Worker 런타임 환경에는 없어서, 요청 때 렌더되는
  // 페이지(/s 등)의 og:image·canonical이 localhost로 나가던 문제를 막는다. 비밀값이 아니다(공개 주소).
  env: { SITE_URL: process.env.SITE_URL ?? "", SITE_NOINDEX: process.env.SITE_NOINDEX ?? "" },
  poweredByHeader: false,
  // 같은 출처 rewrite: 브라우저는 /api/* 로 부르고 서버(Ktor 또는 mock)로 넘긴다(contracts/openapi.yaml servers).
  async rewrites() {
    return [
      // Cloud Run 앞단이 루트 `/healthz`를 예약해 앱에 닿기 전에 404를 주므로 `/v1/healthz`를 쓴다(계약상 같은 응답).
      { source: "/api/healthz", destination: `${origin}/v1/healthz` },
      { source: "/api/v1/:path*", destination: `${origin}/v1/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders({
          production: process.env.NODE_ENV === "production",
          posthogHost: analytics?.host,
          kakaoShare: publicKakaoJsKey() !== null,
          hsts: isHttpsCanonicalSite(),
        }),
      },
    ];
  },
};

export default nextConfig;

// `next dev`에서 Cloudflare 바인딩을 흉내 낸다(OpenNext 권장 설정). 배포는 하지 않는다.
void initOpenNextCloudflareForDev();
