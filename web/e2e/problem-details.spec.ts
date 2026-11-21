import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { horizontalOverflow } from "./support/layout";

/**
 * 오류 응답이 `application/problem+json`(RFC 9457)으로 바뀐 뒤: ① 웹은 사람에게 보이는 문구를 `detail`로 쓴다 ② 응답의 `type` 주소(`/problems/<code>`)가 열린다.
 */

// 방 만들기에서 서버가 준 문구를 그대로 보여 주는 경로: 웹이 모르는 code의 4xx(알려진 code는 웹 문구를 쓴다).
const NEW_CODE = "SOME_NEW_CODE";
// 폼의 오류 문구(`role="alert"`). 라우트 안내(`__next-route-announcer__`)도 같은 role이라 폼 안으로 좁힌다.
const formAlert = (page: Page) => page.locator("form").getByRole("alert");

async function openCreateForm(page: Page) {
  const warmUp = page.waitForRequest((req) => req.url().endsWith("/api/healthz"));
  await page.goto("/r/new");
  await warmUp;
  await page.getByRole("combobox", { name: "내 출발역" }).fill("혜화");
  await page.getByRole("option", { name: /^혜화\s?4호선/ }).click();
}

async function submitWith(page: Page, response: { contentType: string; body: unknown }) {
  await page.route("**/api/v1/rooms", (route) =>
    route.fulfill({ status: 400, contentType: response.contentType, body: JSON.stringify(response.body) }),
  );
  await openCreateForm(page);
  await page.getByRole("button", { name: "방 만들기" }).click();
}

test("새 형식(application/problem+json)이면 detail을 보여 준다", async ({ page }) => {
  await submitWith(page, {
    contentType: "application/problem+json; charset=UTF-8",
    body: {
      type: `https://banbanyeok.app/problems/${NEW_CODE.toLowerCase().replaceAll("_", "-")}`,
      title: "제목",
      status: 400,
      detail: "새 형식의 설명이에요",
      code: NEW_CODE,
    },
  });
  await expect(formAlert(page)).toContainText("새 형식의 설명이에요");
});

test("형식 없는 500(HTML 본문)이면 서버 문구 없이 연결 안내를 보여 준다", async ({ page }) => {
  await page.route("**/api/v1/rooms", (route) =>
    route.fulfill({ status: 500, contentType: "text/html", body: "<h1>Internal Server Error</h1>" }),
  );
  await openCreateForm(page);
  await page.getByRole("button", { name: "방 만들기" }).click();
  const alert = formAlert(page);
  await expect(alert).toContainText("서버에 연결하지 못했어요");
  await expect(alert).not.toContainText(/Internal Server Error|HTTP|UNKNOWN/);
});

test("/problems: 코드 목록과 앵커, 접근성 위반 0, 가로 넘침 없음, 검색 제외", async ({ page }) => {
  await page.goto("/problems");
  await expect(page.getByRole("heading", { level: 1, name: "API 오류 코드" })).toBeVisible();
  expect(await page.locator('meta[name="robots"]').first().getAttribute("content")).toContain("noindex");
  const list = page.getByRole("navigation", { name: "오류 코드 목록" });
  await list.getByRole("link", { name: "ROOM_FULL", exact: true }).click();
  await expect(page).toHaveURL(/\/problems#room-full$/);
  await expect(page.locator("#room-full").getByRole("heading", { name: "방이 가득 참" })).toBeVisible();
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
  expect(await horizontalOverflow(page)).toEqual([]);
});

test("/problems/<kebab-case code>: 응답의 type 주소가 열리고 없는 코드는 404", async ({ page }) => {
  const response = await page.goto("/problems/room-full");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "방이 가득 참" })).toBeVisible();
  await expect(page.getByText("ROOM_FULL")).toBeVisible();
  await page.getByRole("link", { name: "오류 코드 전체 보기" }).click();
  await expect(page).toHaveURL(/\/problems$/);
  const missing = await page.goto("/problems/no-such-code");
  expect(missing?.status()).toBe(404);
});

test("sitemap과 robots.txt에 /problems를 넣지 않는다", async ({ request }) => {
  expect(await (await request.get("/sitemap.xml")).text()).not.toContain("/problems");
  expect(await (await request.get("/robots.txt")).text()).not.toContain("problems");
});
