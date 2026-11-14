import { defineConfig, devices } from "@playwright/test";

/**
 * 실제 서버 대상 e2e. 가짜 서버 없이 이미 떠 있는 웹(→ 로컬 Ktor)에 붙는다. 서버·웹을 띄우는 것은 이 설정의 몫이 아니다.
 * 로컬: `mise run dev`를 띄운 뒤 `REAL_WEB_URL=http://127.0.0.1:$WEB_PORT pnpm e2e:real`(포트는 `bash scripts/dev.sh config`).
 */
export default defineConfig({
  testDir: "e2e-real",
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.REAL_WEB_URL ?? "http://127.0.0.1:3000",
    locale: "ko-KR",
    trace: "retain-on-failure",
  },
  projects: [{ name: "mobile-chrome", use: { ...devices["Pixel 7"] } }],
});
