// vinext 비교 실험(#254) 전용 빌드 설정(`pnpm build:vinext`). 운영 빌드(`pnpm cf:build`, OpenNext)는 이 파일을 읽지 않는다.
// 캐시는 OpenNext의 정적 자산 증분 캐시(open-next.config.ts)에 대응하는 Static Assets 응답 캐시다(빌드 때 사전 렌더, 읽기 전용).
import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import { staticAssetsAdapter } from "@vinext/cloudflare/cache/static-assets-adapter";
import vinext from "vinext";
import { defineConfig } from "vite";

export default defineConfig({
  // 로컬 `vite preview`만 쓰는 값: 리디렉트 비교(spikes/vinext/redirect.sh)가 Host 헤더로 www·workers.dev를 흉내 낸다.
  preview: { allowedHosts: [".banbanyeok.app", ".workers.dev"] },
  resolve: {
    alias: {
      "@opennextjs/cloudflare": fileURLToPath(new URL("./vinext/opennext-context.ts", import.meta.url)),
      // 비호환 재현(기본)과 해결안 측정(VINEXT_SEO_BUNDLE=1)을 같은 설정으로 만든다. 이유는 vinext/seo-load.ts.
      ...(process.env.VINEXT_SEO_BUNDLE === "1"
        ? { "@/lib/seo/load": fileURLToPath(new URL("./vinext/seo-load.ts", import.meta.url)) }
        : {}),
    },
  },
  plugins: [
    vinext({
      cache: { cdn: staticAssetsAdapter() },
      prerender: { routes: "*" },
    }),
    cloudflare({
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
});
