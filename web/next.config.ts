import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";
import { analyticsConfig } from "./src/lib/analytics/config";
import { apiOrigin } from "./src/lib/api/config";
import { securityHeaders } from "./src/lib/security/headers";
import { isHttpsCanonicalSite } from "./src/lib/seo/site";

const origin = apiOrigin();
const analytics = analyticsConfig({
  key: process.env.NEXT_PUBLIC_POSTHOG_KEY,
  host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // 같은 출처 rewrite: 브라우저는 /api/* 로 부르고 서버(Ktor 또는 mock)로 넘긴다(contracts/openapi.yaml servers).
  async rewrites() {
    return [
      { source: "/api/healthz", destination: `${origin}/healthz` },
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
          hsts: isHttpsCanonicalSite(),
        }),
      },
    ];
  },
};

export default nextConfig;

// `next dev`에서 Cloudflare 바인딩을 흉내 낸다(OpenNext 권장 설정). 배포는 하지 않는다.
void initOpenNextCloudflareForDev();
