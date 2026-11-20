import { expect, type Page, test } from "@playwright/test";
import { checkLayout } from "./support/checks";
import { horizontalOverflow } from "./support/layout";
import { prepareRoom } from "./support/room-fixture";

/**
 * 집에 가는 막차(#62) 화면. 가짜 서버(mock/recommend.ts)가 노선과 거리로 꾸민 막차를 준다(실제 시간표가 아니다):
 * 같은 노선이면 열차 한 대(9호선은 여유 시각, 그 밖은 직행 확정), 다른 노선이면 갈아타는 여유 시각, 토요일의 갈아타는 길은 확인 필요.
 * 여기서는 세 가지 모양과 숨김·옛 링크 규칙, 좁은 화면의 배치를 본다. 실제 값은 e2e-real이 실제 서버로 본다.
 */
// 강남(2호선·신분당선)·잠실(2·8호선)·광교(신분당선)·가양(9호선): 1위 양재(3호선·신분당선).
const MIXED = "v=2&o=k3a.dxy.dzc.62d&m=f&t=weekday-night&n=66-87IiY..7KeA7Jew.";

const section = (page: Page) => page.getByRole("region", { name: "집에 가는 막차" });

test.describe("집에 가는 막차", () => {
  test.use({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });

  test("1위 카드에 직행 확정·여유 시각이 섞여 보이고, 지도 버튼은 만날 역에서 각자의 출발역 방향으로 연다", async ({
    page,
  }) => {
    const kakao: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).hostname.endsWith("kakao.com")) kakao.push(request.url());
    });
    await page.goto(`/result?${MIXED}`);
    const first = section(page).first();
    await expect(first).toBeVisible();
    await expect(first.getByText("평일 시간표")).toBeVisible();
    // 맨 위 한 줄: 가장 먼저 나서야 하는 사람.
    await expect(first.getByText(/전에 나서야 해요$/)).toBeVisible();

    const rows = first.getByRole("listitem");
    await expect(rows).toHaveCount(4);
    // 민수(강남, 신분당선으로 양재): 직행 확정은 분 그대로이고 버튼이 없다.
    await expect(rows.nth(0)).toContainText(/민수막차\d\d:\d\d.*강남행양재역에서 열차가 떠나는 시각이에요\./);
    await expect(rows.nth(0).getByRole("link")).toHaveCount(0);
    // 참가자 2(잠실): 갈아타는 여유 시각은 10분 단위다.
    await expect(rows.nth(1)).toContainText(/늦어도\d\d:\d0엔출발하세요/);
    await expect(rows.nth(1)).toContainText("갈아타는 길이라 넉넉히 일찍 잡았어요.");
    const link = rows.nth(1).getByRole("link", { name: "참가자 2, 지도 앱에서 막차 확인하기" });
    await expect(link).toHaveAttribute("target", "_blank");
    const href = (await link.getAttribute("href")) ?? "";
    // 돌아가는 길: 만날 역(양재역)이 먼저, 그 사람의 출발역(잠실역)이 나중이다.
    expect(decodeURIComponent(href)).toMatch(
      /^https:\/\/map\.kakao\.com\/link\/by\/traffic\/양재역,[\d.]+,[\d.]+\/잠실역,/,
    );
    await expect(first.getByText(/^2026년 11월 16일 시간표로 계산했어요\./)).toBeVisible();

    // 누르기 전에는 카카오로 가는 요청이 없다(링크는 이용자가 누를 때만 연다).
    expect(kakao).toEqual([]);
    expect(await horizontalOverflow(page)).toEqual([]);
  });

  test("2·3위는 펼치면 같은 칸이 보인다", async ({ page }) => {
    await page.goto(`/result?${MIXED}`);
    // 접힌 줄 안의 칸은 보이지 않는다(접근성 트리에도 없다).
    await expect(section(page)).toHaveCount(1);
    await page.locator("details").first().locator("summary").click();
    await expect(section(page)).toHaveCount(2);
    await expect(section(page).nth(1)).toBeVisible();
    await expect(section(page).nth(1).getByRole("listitem")).toHaveCount(4);
    expect(await horizontalOverflow(page)).toEqual([]);
  });

  test("토요일은 일부 노선만 보여 준다고 알리고, 준비되지 않은 길은 시각 없이 이유와 지도 버튼만 보인다", async ({
    page,
  }) => {
    await page.goto(`/result?${MIXED.replace("weekday-night", "saturday-night")}`);
    const first = section(page).first();
    await expect(first.getByText("토요일 시간표")).toBeVisible();
    await expect(first.getByText("토요일은 일부 노선만 막차를 보여 드려요.")).toBeVisible();
    const waiting = first.getByRole("listitem").filter({ hasText: "이 길의 토요일 막차는 아직 준비 중이에요." });
    await expect(waiting.first()).toBeVisible();
    await expect(waiting.first()).not.toContainText(/\d\d:\d\d/);
    await expect(waiting.first().getByRole("link", { name: /지도 앱에서 막차 확인하기$/ })).toBeVisible();
  });

  test("옛 링크(v=1)에는 막차 칸이 없다", async ({ page }) => {
    await page.goto("/result?v=1&o=k3a.dxy&m=f");
    await expect(page.getByRole("article").first()).toBeVisible();
    await expect(section(page)).toHaveCount(0);
    await page.goto("/s?v=1&o=k3a.dxy&m=f");
    await expect(page.getByRole("article").first()).toBeVisible();
    await expect(section(page)).toHaveCount(0);
    // 같은 출발역이라도 구분을 고른 링크(v=2)에는 있다.
    await page.goto("/s?v=2&o=k3a.dxy&m=f&t=weekday-day");
    await expect(section(page).first()).toBeVisible();
  });

  test("받은 링크에서 '나'를 고르면 내 줄에 (나)가 붙는다", async ({ page }) => {
    await page.goto(`/s?${MIXED}&me=1`);
    await expect(section(page).first().getByRole("listitem").nth(1)).toContainText("참가자 2(나)");
  });

  test("방: 출발역을 숨긴 사람의 막차는 다른 사람 화면에 없고 안내 한 줄만 있다", async ({ page }) => {
    await page.goto(await prepareRoom(page, "host-full"));
    const first = section(page).first();
    await expect(first).toBeVisible();
    await expect(first.getByRole("listitem")).toHaveCount(2);
    await expect(first).not.toContainText("참가자 2");
    await expect(first.getByText("출발역을 숨긴 분의 막차는 본인 화면에서만 보여요.")).toBeVisible();
    await expect(first.getByText("민수는 23:52 전에 나서야 해요")).toBeVisible();
    await expect(first.getByRole("listitem").first()).toContainText("민수(나)막차23:52· 성수행");
    expect(await horizontalOverflow(page)).toEqual([]);
  });

  test("방: 출발역을 숨긴 본인에게는 내 막차가 보이고 나에게만 보인다고 적는다", async ({ page }) => {
    await page.goto(await prepareRoom(page, "hidden-self"));
    const first = section(page).first();
    await expect(first.getByRole("listitem")).toHaveCount(3);
    const mine = first.getByRole("listitem").nth(1);
    await expect(mine).toContainText("참가자 2(나)나에게만 보여요");
    // 22:47 → 22:40
    await expect(mine).toContainText("늦어도22:40엔출발하세요");
    const href = (await mine.getByRole("link").getAttribute("href")) ?? "";
    expect(decodeURIComponent(href)).toMatch(/\/동대문역사문화공원역,[\d.]+,[\d.]+\/합정역,/);
    await expect(first.getByText("출발역을 숨긴 분의 막차는 본인 화면에서만 보여요.")).toHaveCount(0);
    // 맨 위 줄은 출발역을 공개한 사람으로만 정한다(내가 더 일러도 민수다).
    await expect(first.getByText("민수는 23:52 전에 나서야 해요")).toBeVisible();
    expect(await horizontalOverflow(page)).toEqual([]);
  });
});

test.describe("집에 가는 막차 배치", () => {
  for (const size of [
    { id: "320", width: 320, height: 568, touch: true },
    { id: "360", width: 360, height: 780, touch: true },
    { id: "430", width: 430, height: 932, touch: true },
    { id: "1280", width: 1280, height: 800, touch: false },
  ]) {
    test.describe(size.id, () => {
      test.use({
        viewport: { width: size.width, height: size.height },
        isMobile: size.touch,
        hasTouch: size.touch,
        deviceScaleFactor: size.touch ? 2 : 1,
      });

      test("결과 화면: 넘침·겹침·잘림 없고 터치 목표가 충분하다(2·3위를 펼친 상태 포함)", async ({ page }) => {
        await page.goto(`/result?${MIXED}`);
        await expect(section(page).first()).toBeVisible();
        for (const summary of await page.locator("details > summary").all()) await summary.click();
        await checkLayout(
          page,
          [
            section(page)
              .first()
              .getByRole("link", { name: /지도 앱에서 막차 확인하기$/ })
              .first(),
          ],
          size.touch,
        );
      });
    });
  }
});
