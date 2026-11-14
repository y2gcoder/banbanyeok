import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";
import { apiOrigin } from "./src/lib/api/config";
import { loadSeoSite } from "./src/lib/seo/load";
import { reverseRedirects } from "./src/lib/seo/pair-pages";

const origin = apiOrigin();

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
  // 조합 주소는 가나다 순 한 가지만 정규 주소다. 반대 순서(B-A)는 영구 리다이렉트(docs/setup/p5-notes.md 2절).
  async redirects() {
    return reverseRedirects(loadSeoSite().pages);
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;

// `next dev`에서 Cloudflare 바인딩을 흉내 낸다(OpenNext 권장 설정). 배포는 하지 않는다.
void initOpenNextCloudflareForDev();
