import { expect, type Page, test } from "@playwright/test";

// 보안 헤더(CSP·Referrer-Policy 등)가 운영 빌드의 모든 종류의 응답에 붙고, CSP 때문에 막히는 요청이 앱 흐름에 없는지 확인한다.
// (PostHog를 켠 상태에서 동의 뒤에도 막히지 않는지는 e2e-analytics/enabled.spec.ts가 본다.)

function collectCspViolations(page: Page): string[] {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/content security policy/i.test(message.text())) violations.push(message.text());
  });
  page.on("pageerror", (error) => {
    if (/content security policy/i.test(error.message)) violations.push(error.message);
  });
  return violations;
}

async function pickStation(page: Page, field: string, query: string, option: RegExp) {
  await page.getByRole("combobox", { name: field }).fill(query);
  await page.getByRole("option", { name: option }).click();
}

test("모든 응답에 보안 헤더가 붙고 CSP가 외부 스크립트·프레임을 허용하지 않는다", async ({ request }) => {
  for (const path of [
    "/",
    "/privacy",
    "/meet",
    "/robots.txt",
    "/sitemap.xml",
    "/s?v=1&o=zzz.zzz&m=f",
    "/없는-페이지",
  ]) {
    const response = await request.get(path);
    const headers = response.headers();
    expect(headers["x-content-type-options"], path).toBe("nosniff");
    expect(headers["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
    expect(headers["x-frame-options"], path).toBe("DENY");
    expect(headers["permissions-policy"], path).toContain("camera=()");
    const csp = headers["content-security-policy"] ?? "";
    expect(csp, path).toContain("default-src 'self'");
    expect(csp, path).toContain("frame-ancestors 'none'");
    expect(csp, path).toContain("object-src 'none'");
    expect(csp, path).not.toContain("unsafe-eval");
    expect(csp, path).not.toMatch(/script-src[^;]*https?:/);
    // 키 없는 빌드: 통계 호스트가 연결 허용 목록에 없다.
    expect(csp, path).toContain("connect-src 'self';");
    expect(headers["x-powered-by"], path).toBeUndefined();
  }
});

test("핵심 흐름(입력 → 결과 → SEO 페이지)에서 CSP 위반이 없다", async ({ page }) => {
  const violations = collectCspViolations(page);
  await page.goto("/");
  await page.getByRole("textbox", { name: "1번째 사람 이름(선택)" }).fill("민수");
  await pickStation(page, "민수의 출발역", "강남", /^강남\s?2호선/);
  await pickStation(page, "친구1의 출발역", "ㅎㄷㅇㄱ", /^홍대입구\s?2호선/);
  await page.getByRole("button", { name: "만날 역 찾기" }).click();
  await expect(page.getByRole("article").first().getByText("1위")).toBeVisible();
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.goto("/meet");
  await page.locator('a[href^="/meet/"]').first().click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(violations).toEqual([]);
});
