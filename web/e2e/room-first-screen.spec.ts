import { expect, type Locator, type Page, test } from "@playwright/test";
import { horizontalOverflow } from "./support/layout";
import { prepareRoom, type RoomScenario } from "./support/room-fixture";

/**
 * 방 화면 첫 화면(#168). 결과가 있는 방은 폰(390×844)에서 스크롤 없이 1위 역 이름·사람별 줄·"이 역으로 정했어요"가 보여야 한다.
 * 참여자 목록·참여 폼·링크 다시 보내기는 결과 아래로 내렸고, 위의 버튼이 그 칸으로 옮겨 가 포커스를 둔다.
 */
const PHONE = { width: 390, height: 844 };
const topCard = (page: Page) => page.locator("article[aria-labelledby='cand-1']");

/** 문서 기준 아래끝(px). 스크롤하지 않은 첫 화면에서 잰다. */
async function bottomOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("보이지 않는 요소");
  return box.y + box.height;
}

test.describe("방 첫 화면에 1위", () => {
  test.use({ viewport: PHONE, isMobile: true, hasTouch: true });

  const cases: { scenario: RoomScenario; label: string }[] = [
    { scenario: "host-full", label: "방장" },
    { scenario: "hidden-self", label: "출발역을 숨긴 본인" },
    { scenario: "friend-join", label: "링크로 들어와 아직 참여 전" },
  ];
  for (const { scenario, label } of cases) {
    test(`${label}: 1위 이름·사람별 줄·정하기 버튼이 스크롤 없이 보인다`, async ({ page }) => {
      await page.goto(await prepareRoom(page, scenario));
      const card = topCard(page);
      await expect(card).toBeVisible();
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      await expect(card.getByRole("heading", { name: "동대문역사문화공원" })).toBeInViewport({ ratio: 1 });
      // 사람별 요약 줄(3명) 마지막 줄까지.
      const rows = card.locator("ul").first().locator(":scope > li");
      await expect(rows).toHaveCount(3);
      expect(await bottomOf(rows.last())).toBeLessThanOrEqual(PHONE.height);
      // 정하기는 화면에 따라 버튼(정하기) 또는 링크(바로 길찾기)다.
      const name = "이 역으로 정했어요";
      const decide = card.getByRole("button", { name }).or(card.getByRole("link", { name }));
      expect(await bottomOf(decide)).toBeLessThanOrEqual(PHONE.height);
      expect(await horizontalOverflow(page)).toEqual([]);
    });
  }

  test("결과 위 버튼: 들어온 사람 목록으로 옮겨 가 제목에 포커스를 둔다(44px 이상)", async ({ page }) => {
    await page.goto(await prepareRoom(page, "host-full"));
    const jump = page.getByRole("button", { name: "들어온 사람 3/4명" });
    await expect(jump).toBeInViewport();
    expect((await jump.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await jump.click();
    const title = page.getByRole("heading", { name: "들어온 사람", level: 2 });
    await expect(title).toBeFocused();
    await expect(title).toBeInViewport();
    // 방장의 수정·내보내기는 목록에 그대로 있다.
    await expect(page.getByRole("button", { name: "수정 내 항목" })).toBeVisible();
  });

  test("아직 참여 전: '나도 출발역 넣기'가 결과 아래 참여 폼으로 옮겨 가 이름 칸에 포커스를 둔다", async ({ page }) => {
    await page.goto(await prepareRoom(page, "friend-join"));
    await expect(topCard(page)).toBeVisible();
    const cta = page.getByRole("button", { name: "나도 출발역 넣기" });
    await expect(cta).toBeInViewport();
    expect((await cta.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await cta.click();
    const form = page.getByRole("form", { name: "나도 출발역 넣기" });
    await expect(form.getByRole("textbox", { name: /이름 \(선택\)/ })).toBeFocused();
    await expect(form.getByRole("combobox", { name: "내 출발역" })).toBeInViewport();
  });

  test("혼자인 방(결과 전)은 링크 보내기가 맨 위이고 옮겨 가는 버튼이 없다", async ({ page }) => {
    await page.goto(await prepareRoom(page, "host-alone"));
    await expect(page.getByRole("heading", { name: "친구에게 링크를 보내 주세요" })).toBeInViewport();
    await expect(
      page.getByText("각자 출발역을 넣으면 모두에게 공평한 만날 역을 지하철 시간으로 계산해요."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /들어온 사람 \d/ })).toHaveCount(0);
  });
});
