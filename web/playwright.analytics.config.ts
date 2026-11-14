import { defineConfig, devices } from "@playwright/test";

/**
 * 통계를 **켠** 빌드의 e2e: 동의(옵트인)·거부·철회·DNT/GPC와 실제 전송 내용. 가짜 키·EU 호스트로 빌드하고, PostHog로 가는 요청은
 * 브라우저에서 가로채 검사한다(외부로 나가지 않는다). 키는 빌드 때 박히므로 기본 e2e(키 없는 빌드) 뒤에 이어서 다시 빌드한다:
 * `pnpm e2e`가 둘을 차례로 돌리고(CI 포함), 이것만 돌리려면 `pnpm e2e:analytics`. 같은 `.next`를 쓰므로 동시에 돌리지 않는다.
 */
const webPort = Number(process.env.E2E_WEB_PORT ?? 3100);
const mockPort = Number(process.env.E2E_MOCK_PORT ?? 4010);
const apiOrigin = `http://127.0.0.1:${mockPort}`;

export default defineConfig({
  testDir: "e2e-analytics",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"]] : "list",
  use: { baseURL: `http://127.0.0.1:${webPort}`, locale: "ko-KR", trace: "retain-on-failure" },
  projects: [{ name: "mobile-chrome", use: { ...devices["Pixel 7"] } }],
  webServer: [
    {
      command: "node mock/main.ts",
      env: { MOCK_PORT: String(mockPort) },
      url: `${apiOrigin}/healthz`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `pnpm build && pnpm start --port ${webPort}`,
      env: {
        API_ORIGIN: apiOrigin,
        SITE_URL: `http://127.0.0.1:${webPort}`,
        // 가짜 프로젝트 토큰(형식만 맞음). 요청은 아래 spec이 가로채므로 실제 PostHog에는 닿지 않는다.
        NEXT_PUBLIC_POSTHOG_KEY: "phc_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345",
        NEXT_PUBLIC_POSTHOG_HOST: "https://eu.i.posthog.com",
      },
      url: `http://127.0.0.1:${webPort}/`,
      timeout: 240_000,
      reuseExistingServer: false,
    },
  ],
});
