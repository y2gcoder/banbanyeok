import { expect, type Page, test } from "@playwright/test";
import { horizontalOverflow } from "./support/layout";
import { FAKE_ROOM_ID, prepareRoom } from "./support/room-fixture";

/**
 * W5: ① 방장이 방을 지우면(서버가 404 ROOM_NOT_FOUND) 참여자가 열어 둔 방 화면이 이전 목록·버튼을 남기지 않고 "찾을 수 없는 방"으로 바뀐다
 * (탭으로 돌아올 때, 그리고 15초 폴링 안에). ② "날짜 선택…" 칩의 글자가 칩 가장자리에 붙지 않고 넘치지 않는다.
 */

const gone = (page: Page) =>
  page.route("**/api/v1/rooms/**", (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ code: "ROOM_NOT_FOUND", message: "없는 방이에요" }),
    }),
  );

async function openRoom(page: Page) {
  await page.goto(await prepareRoom(page, "host-full"));
  await expect(page.getByRole("heading", { name: "만날 역 후보" })).toBeVisible();
  await expect(page.getByRole("article").first()).toBeVisible();
}

async function expectRoomGone(page: Page, timeout: number) {
  await expect(page.getByRole("heading", { name: "찾을 수 없는 방이에요" })).toBeVisible({ timeout });
  // 이전 화면(목록·공유·수정·삭제)과 되살릴 수 없는 "다시 시도"가 남아 있지 않다.
  await expect(page.getByRole("heading", { name: "만날 역 후보" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "다시 시도" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /방 삭제/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "새 방 만들기" })).toBeVisible();
  expect(await page.evaluate((id) => window.localStorage.getItem(`bby.room.${id}`), FAKE_ROOM_ID)).toBeNull();
}

test("방이 지워진 뒤 탭으로 돌아오면(visibilitychange) 방 화면 전체가 방 없음 안내로 바뀐다", async ({ page }) => {
  await openRoom(page);
  await gone(page);
  await page.waitForTimeout(5_500); // staleTime(5초) 뒤에 돌아와야 다시 불러온다.
  await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
  await expectRoomGone(page, 5_000);
});

test("탭이 보이는 채로 두어도 폴링 주기(15초) 안에 방 없음 안내로 바뀐다", async ({ page }) => {
  await openRoom(page);
  await gone(page);
  await expectRoomGone(page, 20_000);
});

test.describe("날짜 선택 칩 글자", () => {
  for (const size of [
    { width: 320, height: 568, touch: true },
    { width: 390, height: 844, touch: true },
    { width: 768, height: 1024, touch: true },
    { width: 1024, height: 800, touch: false },
    { width: 1280, height: 800, touch: false },
  ]) {
    test.describe(`${size.width}px`, () => {
      test.use({
        viewport: { width: size.width, height: size.height },
        hasTouch: size.touch,
        isMobile: size.touch,
      });

      test("글자가 칩 안에서 여백을 두고 넘침이 없다", async ({ page }) => {
        const warmUp = page.waitForRequest((req) => req.url().endsWith("/api/healthz"));
        await page.goto("/r/new");
        await warmUp;
        const chip = page.locator("label", { has: page.getByLabel("날짜 고르기") });
        await expect(chip).toContainText("날짜 선택…");
        const { chipWidth, textWidth } = await chip.evaluate((el) => ({
          chipWidth: el.getBoundingClientRect().width,
          textWidth: el.querySelector("span")?.getBoundingClientRect().width ?? 0,
        }));
        // 글자 폭 + 좌우 안쪽 여백(각 12px 이상)이 칩 안에 들어간다.
        expect(textWidth + 24).toBeLessThanOrEqual(chipWidth + 0.5);
        expect(await horizontalOverflow(page)).toEqual([]);
      });
    });
  }
});
