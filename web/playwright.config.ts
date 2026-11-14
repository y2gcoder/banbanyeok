import { defineConfig, devices } from "@playwright/test";

/**
 * 모바일 뷰포트 e2e. 가짜 서버(mock/)와 프로덕션 빌드(next start)를 띄워 입력 → 결과 → 공유 링크 열기를 확인한다.
 * 포트는 E2E_WEB_PORT/E2E_MOCK_PORT로 바꿀 수 있다(다른 worktree와 동시 실행).
 */
const webPort = Number(process.env.E2E_WEB_PORT ?? 3100);
const mockPort = Number(process.env.E2E_MOCK_PORT ?? 4010);
const apiOrigin = `http://127.0.0.1:${mockPort}`;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    locale: "ko-KR",
    trace: "retain-on-failure",
  },
  projects: [{ name: "mobile-chrome", use: { ...devices["Pixel 7"] } }],
  webServer: [
    {
      command: "node mock/main.ts",
      env: { MOCK_PORT: String(mockPort) },
      url: `${apiOrigin}/healthz`,
      reuseExistingServer: !process.env.CI,
    },
    {
      // rewrite 대상(API_ORIGIN)은 빌드 때 정해지므로 같은 값으로 빌드하고 실행한다.
      command: `pnpm build && pnpm start --port ${webPort}`,
      // SITE_URL도 빌드 때 정해진다(canonical·OG 주소가 정적 페이지에 들어간다).
      // 통계 키는 비워서 빌드한다: 개발자 환경 변수와 무관하게 "키 없음 = 완전히 꺼짐"을 e2e로 확인한다(e2e/analytics.spec.ts).
      env: {
        API_ORIGIN: apiOrigin,
        SITE_URL: `http://127.0.0.1:${webPort}`,
        NEXT_PUBLIC_POSTHOG_KEY: "",
        NEXT_PUBLIC_POSTHOG_HOST: "",
      },
      url: `http://127.0.0.1:${webPort}/`,
      timeout: 240_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
