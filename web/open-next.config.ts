// OpenNext Cloudflare 빌드 설정(pnpm cf:build).
// 미리 만든(SSG) 페이지와 OG 이미지는 Workers 정적 자산에서 읽는다(읽기 전용 증분 캐시). 이 설정이 없으면 "정적" 페이지도
// 요청마다 Worker 안에서 다시 렌더되어 무료 플랜 CPU(요청당 10ms)를 쓰고, 파일을 읽는 SEO 페이지는 아예 실패한다(docs/setup/p5-notes.md 4절).
// 재검증(ISR)이 필요해지면 R2/KV 캐시로 바꾼다(P8).
import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

export default defineCloudflareConfig({ incrementalCache: staticAssetsIncrementalCache });
