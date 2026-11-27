import { expect, test } from "@playwright/test";
import { problemBody } from "../src/lib/problems/problems";

// 프록시(worker.ts)가 서버 오류·시간 초과를 서버와 같은 `application/problem+json`(502/503/504)으로 돌려줄 때 사용자에게 보이는 처리.
// 브라우저의 /api/v1/recommend 호출만 가로채 같은 응답을 흉내 낸다(프록시 자체는 src/lib/proxy 단위 테스트가 본다).
// 웹은 늘 쿼리(`lastTrainKinds`)를 붙인다.
for (const [status, code] of [
  [504, "UPSTREAM_TIMEOUT"],
  [502, "UPSTREAM_UNAVAILABLE"],
  [503, "UPSTREAM_NOT_CONFIGURED"],
] as const) {
  test(`서버가 ${status}(${code})이면 안내와 다시 시도 경로가 보인다`, async ({ page }) => {
    await page.goto("/result?v=1&o=1qs.2je&m=f");
    await expect(page.getByRole("article").first().getByText("1위")).toBeVisible();

    await page.route("**/api/v1/recommend?*", (route) =>
      route.fulfill({
        status,
        contentType: "application/problem+json; charset=utf-8",
        body: JSON.stringify(problemBody(status, code, "서버가 응답하지 않아요.")),
      }),
    );
    await page.getByRole("tab", { name: "빨리 만나기" }).click();
    await expect(page.getByText("서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.")).toBeVisible();
    await expect(page.getByRole("button", { name: "다시 시도" })).toBeVisible();
    await expect(page.getByRole("link", { name: "출발역 바꾸기" })).toBeVisible();
  });
}

// B1: 서버(CORS)가 허용되지 않은 Origin을 403 + 빈 HTML 본문으로 거절했을 때도 오류 화면에 이유 문구가 있어야 한다(예전에는 버튼만 보였다).
test("계약 밖의 403(빈 HTML 본문)이어도 짧은 안내 문구가 보이고 내부 값은 보이지 않는다", async ({ page }) => {
  await page.goto("/result?v=1&o=1qs.2je&m=f");
  await expect(page.getByRole("article").first().getByText("1위")).toBeVisible();

  await page.route("**/api/v1/recommend?*", (route) =>
    route.fulfill({ status: 403, contentType: "text/html", body: "" }),
  );
  await page.getByRole("tab", { name: "빨리 만나기" }).click();
  const alert = page.getByRole("tabpanel").getByRole("alert");
  await expect(alert).toContainText("이 기준으로는 결과를 받지 못했어요.");
  await expect(alert).not.toContainText(/403|HTTP|UNKNOWN/);
  await expect(page.getByRole("button", { name: "다시 시도" })).toBeVisible();
});
