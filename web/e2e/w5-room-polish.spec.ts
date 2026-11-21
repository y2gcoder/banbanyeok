import { expect, type Page, test } from "@playwright/test";
import { horizontalOverflow } from "./support/layout";
import { FAKE_ROOM_ID, prepareRoom } from "./support/room-fixture";

/**
 * W5: ① 방장이 방을 지우면(서버가 404 ROOM_NOT_FOUND) 참여자가 열어 둔 방 화면이 이전 목록·버튼을 남기지 않고 "찾을 수 없는 방"으로 바뀐다
 * (탭으로 돌아올 때, 그리고 15초 폴링 안에). 시간은 page.clock으로 정해 staleTime(5초)·폴링(15초)을 기다리지 않고 결정적으로 본다.
 * ② "날짜 선택…" 칩과 날짜를 고른 칩의 글자가 한 줄이고 가장자리에 붙지 않는다.
 */

const isRoomRequest = (url: string) => /\/api\/v1\/rooms\//.test(url);

const gone = (page: Page) =>
  page.route("**/api/v1/rooms/**", (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/problem+json",
      body: JSON.stringify({
        type: "https://banbanyeok.app/problems/room-not-found",
        title: "방을 찾을 수 없음",
        status: 404,
        detail: "없는 방이에요",
        code: "ROOM_NOT_FOUND",
        message: "없는 방이에요",
      }),
    }),
  );

async function openRoom(page: Page) {
  await page.clock.install({ time: new Date("2026-11-16T03:00:00Z") });
  await page.goto(await prepareRoom(page, "host-full"));
  await expect(page.getByRole("heading", { name: "만날 역 후보" })).toBeVisible();
  await expect(page.getByRole("article").first()).toBeVisible();
}

async function expectRoomGone(page: Page) {
  await expect(page.getByRole("heading", { name: "찾을 수 없는 방이에요" })).toBeVisible();
  // 이전 화면(목록·공유·수정·삭제)과 되살릴 수 없는 "다시 시도"가 남아 있지 않다.
  await expect(page.getByRole("heading", { name: "만날 역 후보" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "다시 시도" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /방 삭제/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "새 방 만들기" })).toBeVisible();
  expect(await page.evaluate((id) => window.localStorage.getItem(`bby.room.${id}`), FAKE_ROOM_ID)).toBeNull();
}

test("방이 지워진 뒤 탭으로 돌아오면(visibilitychange) 방 요청이 나가고 화면 전체가 방 없음 안내로 바뀐다", async ({
  page,
}) => {
  await openRoom(page);
  await gone(page);
  await page.clock.fastForward(5_500); // staleTime(5초)이 지나야 돌아올 때 다시 불러온다. 폴링(15초)보다는 이르다.
  const refetch = page.waitForRequest((req) => isRoomRequest(req.url()));
  await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
  await refetch;
  await expectRoomGone(page);
});

test("탭이 보이는 채로 두어도 폴링 주기(15초)가 지나면 방 요청이 나가고 방 없음 안내로 바뀐다", async ({ page }) => {
  await openRoom(page);
  await gone(page);
  const poll = page.waitForRequest((req) => isRoomRequest(req.url()));
  await page.clock.fastForward(16_000);
  await poll;
  await expectRoomGone(page);
});

test("방 없음을 받은 뒤에는 폴링·탭 복귀로 방 요청을 더 보내지 않는다", async ({ page }) => {
  await openRoom(page);
  await gone(page);
  const poll = page.waitForRequest((req) => isRoomRequest(req.url()));
  await page.clock.fastForward(16_000);
  await poll;
  await expectRoomGone(page);
  const later: string[] = [];
  page.on("request", (req) => {
    if (isRoomRequest(req.url())) later.push(req.url());
  });
  await page.clock.fastForward(60_000);
  await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
  await page.clock.fastForward(16_000);
  expect(later).toEqual([]);
});

/** 칩 안의 글자(각 span)가 한 줄이고, 칩 안에 좌우 여백을 두고 들어간다. */
async function expectChipTextTidy(page: Page) {
  const chip = page.locator("label", { has: page.getByLabel("날짜 선택") });
  const { chipWidth, spans } = await chip.evaluate((el) => ({
    chipWidth: el.getBoundingClientRect().width,
    spans: [...el.querySelectorAll("span")].map((span) => {
      const style = getComputedStyle(span);
      return {
        text: span.textContent ?? "",
        width: span.getBoundingClientRect().width,
        height: span.getBoundingClientRect().height,
        lineHeight: Number.parseFloat(style.lineHeight),
      };
    }),
  }));
  for (const span of spans) {
    expect(span.height, `"${span.text}"가 한 줄이다`).toBeLessThan(span.lineHeight * 1.5);
    expect(span.width + 24, `"${span.text}" 좌우에 여백이 있다`).toBeLessThanOrEqual(chipWidth + 0.5);
  }
}

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

      test("비어 있을 때와 가장 긴 날짜(12월 31일), 공휴일(12월 25일)을 골랐을 때 한 줄이고 넘침이 없다", async ({
        page,
      }) => {
        await page.clock.install({ time: new Date("2026-12-05T03:00:00Z") });
        const warmUp = page.waitForRequest((req) => req.url().endsWith("/api/healthz"));
        await page.goto("/r/new");
        await warmUp;
        const chip = page.locator("label", { has: page.getByLabel("날짜 선택") });
        await expect(chip).toContainText("날짜 선택…");
        await expectChipTextTidy(page);
        for (const [date, shown, holiday] of [
          ["2026-12-31", "12월 31일", false],
          ["2026-12-25", "12월 25일", true],
        ] as const) {
          await page.getByLabel("날짜 선택").fill(date);
          await expect(chip).toContainText(shown);
          if (holiday) await expect(chip).toContainText("공휴일");
          await expectChipTextTidy(page);
          expect(await horizontalOverflow(page)).toEqual([]);
        }
      });
    });
  }
});
