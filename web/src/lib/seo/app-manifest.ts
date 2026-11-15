/**
 * 홈 화면에 추가했을 때의 앱 정보(웹 앱 매니페스트)와 브라우저 테마 색. `app/manifest.ts`·루트 레이아웃이 쓴다.
 *
 * - 색은 `globals.css` 토큰 값 그대로다(`app-manifest.test.ts`가 대조한다). 화면은 밝은 모드 하나(`color-scheme: light`)라
 *   주소창·상태 표시줄 색도 사용자 기기 설정(밝은/어두운)과 상관없이 승강장 회색 하나로 둔다. 어두운 모드에 어두운 막대를 주면
 *   밝은 화면 위에 어두운 막대가 얹혀 따로 논다.
 * - `display: standalone`이지만 서비스 워커는 만들지 않는다(오프라인 동작 없음, 설치 시 브라우저 기본 동작만).
 * - 아이콘 파일은 `scripts/build-icons.ts`가 `assets/icons/`의 SVG에서 만든다.
 */
import type { MetadataRoute } from "next";

/** `--platform`(승강장 타일 회색). 바탕·테마 색. */
export const PLATFORM_COLOR = "#eef1f0";

export const APP_NAME = "반반역";

export function appManifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: APP_NAME,
    short_name: APP_NAME,
    description: "각자 지하철 시간으로 계산해서 공평하게 만날 역을 찾아요.",
    lang: "ko",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: PLATFORM_COLOR,
    theme_color: PLATFORM_COLOR,
    categories: ["navigation", "travel", "utilities"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
