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
/** 2·3위 줄을 펼치는 손잡이. 막차 칸도 접는 칸(details)이라 "다른 후보"의 바로 아래 것만 고른다. */
const otherRows = (page: Page) => page.getByRole("region", { name: "다른 후보" }).locator(":scope > details > summary");
/** 1위 카드(#122)는 요약이 먼저다. 막차 칸 전체는 "자세히"를 펴야 보인다. */
const topCard = (page: Page) => page.locator("article[aria-labelledby='cand-1']");
async function openTop(page: Page) {
  await topCard(page)
    .getByRole("button", { name: /자세히/ })
    .click();
}

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
    await openTop(page);
    const first = section(page).first();
    await expect(first).toBeVisible();
    await expect(first.getByText("평일 시간표")).toBeVisible();
    // 맨 위 한 줄: 모두 시각이 있으면 가장 먼저 나서야 하는 사람.
    await expect(first.getByText(/ 전 출발$/)).toBeVisible();
    // 영역 이름에 역 이름이 들어간다(후보를 여러 개 펼쳐도 구분된다).
    await expect(page.getByRole("region", { name: "양재역 집에 가는 막차" })).toHaveCount(1);

    const rows = first.getByRole("listitem");
    await expect(rows).toHaveCount(4);
    // 민수(강남, 신분당선으로 양재): 직행 확정은 분 그대로이고 버튼이 없다.
    await expect(rows.nth(0)).toContainText(/민수막차\d\d:\d\d.*강남행양재역 출발 시각/);
    await expect(rows.nth(0).getByRole("link")).toHaveCount(0);
    // 참가자 2(잠실): 갈아타는 여유 시각은 10분 단위다.
    await expect(rows.nth(1)).toContainText(/늦어도\d\d:\d0출발/);
    await expect(rows.nth(1)).toContainText("환승 경로라 넉넉히 이르게 잡은 시각.");
    const link = rows.nth(1).getByRole("link", { name: "참가자 2, 지도 앱에서 막차 확인하기" });
    await expect(link).toHaveAttribute("target", "_blank");
    const href = (await link.getAttribute("href")) ?? "";
    // 돌아가는 길: 만날 역(양재역)이 먼저, 그 사람의 출발역(잠실역)이 나중이다.
    expect(decodeURIComponent(href)).toMatch(
      /^https:\/\/map\.kakao\.com\/link\/by\/traffic\/양재역,[\d.]+,[\d.]+\/잠실역,/,
    );
    // 기준일은 시간표를 모은 날이다(적용일이 아니다).
    await expect(first.getByText(/^시간표 수집 기준 2026년 11월 16일\. 공사·행사로/)).toBeVisible();
    await expect(first).not.toContainText("계산했어요");

    // 누르기 전에는 카카오로 가는 요청이 없다(링크는 이용자가 누를 때만 연다).
    expect(kakao).toEqual([]);
    expect(await horizontalOverflow(page)).toEqual([]);
  });

  test("2·3위는 펼치면 같은 칸이 보인다", async ({ page }) => {
    await page.goto(`/result?${MIXED}`);
    // 접힌 줄 안의 칸은 보이지 않는다(접근성 트리에도 없다). 1위의 칸도 "자세히" 안이다.
    await expect(topCard(page)).toBeVisible();
    await expect(section(page)).toHaveCount(0);
    await openTop(page);
    await expect(section(page)).toHaveCount(1);
    await otherRows(page).first().click();
    await expect(section(page)).toHaveCount(2);
    await expect(section(page).nth(1)).toBeVisible();
    await expect(section(page).nth(1).getByRole("listitem")).toHaveCount(4);
    // 펼친 칸마다 영역 이름이 다르다(역 이름이 앞에 붙는다).
    await otherRows(page).nth(1).click();
    const names = await section(page).evaluateAll((nodes) =>
      nodes.map((node) => document.getElementById(node.getAttribute("aria-labelledby") ?? "")?.textContent ?? ""),
    );
    expect(names).toHaveLength(3);
    expect(new Set(names).size).toBe(3);
    for (const name of names) expect(name).toMatch(/역 집에 가는 막차$/);
    expect(await horizontalOverflow(page)).toEqual([]);
  });

  test("1위 카드는 펼치지 않아도 가장 이른 막차 한 줄이 보이고, 정했어요와 2위가 폰 첫 화면에 들어온다", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/result?${MIXED}`);
    const card = topCard(page);
    // 막차는 숨기지 않는다: 접힌 1위 카드에도 맨 위 한 줄과 같은 말이 있다.
    // 펼치지 않은 칸의 같은 말은 숨어 있다(접근성 트리에도 없다): 처음 것이 요약 줄이다.
    await expect(card.getByText(/ 전 출발$/).first()).toBeVisible();
    await expect(section(page)).toHaveCount(0);
    const choose = card.getByRole("button", { name: /이 역으로 정했어요/ });
    await expect(choose).toBeInViewport();
    await expect(otherRows(page).first()).toBeInViewport();
    expect(await horizontalOverflow(page)).toEqual([]);
  });

  test("'자세히'와 막차 제목은 버튼(aria-expanded)이고, 키보드로도 접고 편다", async ({ page }) => {
    await page.goto(`/result?${MIXED}`);
    const more = topCard(page).getByRole("button", { name: /자세히/ });
    await expect(more).toHaveAttribute("aria-expanded", "false");
    expect((await more.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await more.focus();
    await page.keyboard.press("Enter");
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await expect(more).toBeFocused();
    const first = section(page).first();
    const rows = first.getByRole("listitem");
    await expect(rows.first()).toBeVisible();
    // 막차 칸은 "자세히" 안에서 펼친 채로 시작하고, 제목 버튼으로 접는다.
    const toggle = first.getByRole("button", { name: /집에 가는 막차/ });
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect((await toggle.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(rows.first()).toBeHidden();
    // 접어도 가장 이른 시각 한 줄은 제목 아래에 남는다.
    await expect(toggle.getByText(/ 전 출발$/)).toBeVisible();
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(rows.first()).toBeVisible();
  });

  test("토요일은 일부 노선만 보여 준다고 알리고, 준비되지 않은 길은 시각 없이 이유와 지도 버튼만 보인다", async ({
    page,
  }) => {
    await page.goto(`/result?${MIXED.replace("weekday-night", "saturday-night")}`);
    await openTop(page);
    const first = section(page).first();
    await expect(first.getByText("토요일 시간표")).toBeVisible();
    await expect(first.getByText("토요일은 일부 노선만 막차 표시.")).toBeVisible();
    const waiting = first.getByRole("listitem").filter({ hasText: "이 경로의 토요일 막차는 준비 중." });
    await expect(waiting.first()).toBeVisible();
    await expect(waiting.first()).not.toContainText(/\d\d:\d\d/);
    await expect(waiting.first().getByRole("link", { name: /지도 앱에서 막차 확인하기$/ })).toBeVisible();
  });

  test("옛 링크(v=1)에는 막차 칸이 없다", async ({ page }) => {
    // 1위 카드는 "자세히"를 펴야 칸 전체가 보이므로 펴고 본다(접힌 요약 줄도 없다).
    await page.goto("/result?v=1&o=k3a.dxy&m=f");
    await openTop(page);
    await expect(section(page)).toHaveCount(0);
    await expect(topCard(page).getByText(/^막차/)).toHaveCount(0);
    await page.goto("/s?v=1&o=k3a.dxy&m=f");
    await openTop(page);
    await expect(section(page)).toHaveCount(0);
    // 같은 출발역이라도 구분을 고른 링크(v=2)에는 있다.
    await page.goto("/s?v=2&o=k3a.dxy&m=f&t=weekday-day");
    await openTop(page);
    await expect(section(page).first()).toBeVisible();
  });

  test("받은 링크에서 '나'를 고르면 내 줄에 (나)가 붙는다", async ({ page }) => {
    await page.goto(`/s?${MIXED}&me=1`);
    await openTop(page);
    await expect(section(page).first().getByRole("listitem").nth(1)).toContainText("참가자 2(나)");
  });

  test("방: 출발역을 숨긴 사람의 막차는 다른 사람 화면에 없고 안내 한 줄만 있다", async ({ page }) => {
    await page.goto(await prepareRoom(page, "host-full"));
    await openTop(page);
    const first = section(page).first();
    await expect(first).toBeVisible();
    await expect(first.getByRole("listitem")).toHaveCount(2);
    await expect(first).not.toContainText("참가자 2");
    await expect(first.getByText("출발역을 숨긴 분의 막차는 본인 화면에서만 보여요.")).toBeVisible();
    // 공개한 사람 가운데 확인 필요(긴 이름의 친구)가 있어, 맨 위 줄이 범위를 밝힌다.
    await expect(first.getByText("공개된 시각 중 가장 이름: 민수 23:52 · 더 확인할 분 있음")).toBeVisible();
    await expect(first.getByRole("listitem").first()).toContainText("민수(나)막차23:52· 성수행");
    // 모두 시각이 있지 않아도, 일부 노선만 계산한 요일 종류면 알린다.
    await expect(first.getByText("토요일은 일부 노선만 막차 표시.")).toBeVisible();
    expect(await horizontalOverflow(page)).toEqual([]);
  });

  test("방: 새벽 약속(토요일 02:59)에서는 약속보다 먼저 떠나는 막차를 귀가 시각으로 보이지 않는다", async ({
    page,
  }) => {
    await page.goto(await prepareRoom(page, "host-full", undefined, "dawn"));
    await openTop(page);
    const first = section(page).first();
    await expect(first.getByRole("listitem")).toHaveCount(2);
    // 금요일 운행일의 24:27 = 토요일 00:27, 약속(02:59)보다 먼저다.
    const mine = first.getByRole("listitem").first();
    await expect(mine).toContainText("민수(나)11월 28일 00:27 막차는 약속 전에 떠나요.");
    await expect(mine.getByRole("link", { name: "민수, 지도 앱에서 막차 확인하기" })).toBeVisible();
    await expect(first.getByText("약속 전에 막차가 떠나는 분이 있어요.")).toBeVisible();
    await expect(first).not.toContainText(/다음 날|전 출발|성수행/);
    expect(await horizontalOverflow(page)).toEqual([]);
  });

  test("방: 약속 날짜가 없으면 이유를 먼저 말하고, 요일·일부 노선·'계산했어요'는 보이지 않는다", async ({ page }) => {
    await page.goto(await prepareRoom(page, "host-full", undefined, "undated"));
    await openTop(page);
    const first = section(page).first();
    await expect(
      first.getByText("약속 날짜가 없어 요일을 알 수 없어요. 요일마다 막차가 달라 보여 드리지 못해요."),
    ).toHaveCount(1);
    await expect(first.getByRole("listitem")).toHaveCount(2);
    await expect(first.getByRole("link", { name: /지도 앱에서 막차 확인하기$/ })).toHaveCount(2);
    await expect(first.getByText("시간표 수집 기준 2026년 11월 16일.")).toBeVisible();
    await expect(first).not.toContainText(/평일|일부 노선|계산했어요|전 출발|\d\d:\d\d/);
    expect(await horizontalOverflow(page)).toEqual([]);
  });

  test("방: 모두 출발역을 숨겼으면 본인이 아닌 사람에게는 '본인 화면에서만 보여요'만 보인다", async ({ page }) => {
    await page.goto(await prepareRoom(page, "friend-join", undefined, "all-hidden"));
    await openTop(page);
    const first = section(page).first();
    await expect(first).toBeVisible();
    await expect(first.getByText("출발역을 숨긴 분의 막차는 본인 화면에서만 보여요.")).toBeVisible();
    await expect(first.getByRole("listitem")).toHaveCount(0);
    await expect(first).not.toContainText(/토요일|일부 노선|수집 기준|\d\d:\d\d/);
  });

  test("방: 출발역을 숨긴 본인에게는 내 막차가 보이고 나에게만 보인다고 적는다", async ({ page }) => {
    await page.goto(await prepareRoom(page, "hidden-self"));
    await openTop(page);
    const first = section(page).first();
    await expect(first.getByRole("listitem")).toHaveCount(3);
    const mine = first.getByRole("listitem").nth(1);
    await expect(mine).toContainText("참가자 2(나)나에게만 보여요");
    // 22:47 → 22:40
    await expect(mine).toContainText("늦어도22:40출발");
    const href = (await mine.getByRole("link").getAttribute("href")) ?? "";
    expect(decodeURIComponent(href)).toMatch(/\/동대문역사문화공원역,[\d.]+,[\d.]+\/합정역,/);
    await expect(first.getByText("출발역을 숨긴 분의 막차는 본인 화면에서만 보여요.")).toHaveCount(0);
    // 맨 위 줄은 출발역을 공개한 사람으로만 정한다(내가 더 일러도 민수다). 숨긴 내 값은 공용 문구에 쓰지 않는다.
    await expect(first.getByText("공개된 시각 중 가장 이름: 민수 23:52 · 더 확인할 분 있음")).toBeVisible();
    await expect(first.getByText(/22:40.*가장 이름/)).toHaveCount(0);
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
        await openTop(page);
        await expect(section(page).first()).toBeVisible();
        for (const summary of await otherRows(page).all()) await summary.click();
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
