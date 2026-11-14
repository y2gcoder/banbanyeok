import { expect, test } from "@playwright/test";

// 프록시(worker.ts)가 서버 오류·시간 초과를 계약의 오류 형식 JSON(502/504)으로 돌려줄 때 사용자에게 보이는 처리.
// 브라우저의 /api/v1/recommend 호출만 가로채 같은 응답을 흉내 낸다(프록시 자체는 src/lib/proxy 단위 테스트가 본다).
for (const [status, code] of [
  [504, "UPSTREAM_TIMEOUT"],
  [502, "UPSTREAM_UNAVAILABLE"],
  [503, "UPSTREAM_NOT_CONFIGURED"],
] as const) {
  test(`서버가 ${status}(${code})이면 안내와 다시 시도 경로가 보인다`, async ({ page }) => {
    await page.goto("/result?v=1&o=1qs.2je&m=f");
    await expect(page.getByRole("article").first().getByText("1위")).toBeVisible();

    await page.route("**/api/v1/recommend", (route) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify({ code, message: "서버가 응답하지 않아요." }),
      }),
    );
    await page.getByRole("tab", { name: "빨리 만나기" }).click();
    await expect(page.getByText("서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.")).toBeVisible();
    await expect(page.getByRole("button", { name: "다시 시도" })).toBeVisible();
    await expect(page.getByRole("link", { name: "출발역 바꾸기" })).toBeVisible();
  });
}
