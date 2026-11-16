import { expect, type Page, test } from "@playwright/test";
import { orphanedOpenParens, overflowingParenGroups, unguardedOpenParens } from "../e2e/support/line-break";

/**
 * W2: 여는 괄호 "("가 줄 끝에 홀로 남지 않는다(iOS Safari가 keep-all에서 "(" 바로 뒤에서 줄을 바꾼다. docs/setup/w2-paren-notes.md).
 * 배너는 통계 키가 있는 빌드에서만 뜨므로 이 설정(playwright.analytics.config.ts)에서 본다.
 *
 * 한계: 데스크톱 WebKit(Playwright)과 Chromium은 원래 "("에서 줄을 바꾸지 않아 줄 위치 검사만으로는 수정 전에도 통과한다.
 * 그래서 (1) 구조 검사(모든 "("가 묶음 안에 있다)가 수정을 지키고, (2) 줄 위치 검사는 어느 엔진에서든 회귀를 막는다.
 * 진짜 iOS 엔진에서의 측정은 `pnpm ios-sim:line-break`(시뮬레이터)로 한다.
 * `E2E_WEBKIT=1 pnpm e2e:analytics`로 WebKit에서도 돌린다(playwright.analytics.config.ts).
 */
const WIDTHS = [320, 360, 390, 402, 430];

const settle = async (page: Page) => {
  await page.evaluate(() => document.fonts.ready);
};
const banner = (page: Page) => page.getByRole("region", { name: /이용 통계를 모아도 될까요/ });

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });

    test("/privacy: 한눈에 보기·통계 설정·본문의 '(' 뒤에서 줄이 바뀌지 않는다", async ({ page }) => {
      await page.goto("/privacy");
      await settle(page);
      expect(await page.evaluate(orphanedOpenParens, "main")).toEqual([]);
      expect(await page.evaluate(unguardedOpenParens, "main")).toEqual([]);
      // 괄호 묶음(스위치 라벨 같은 좁은 칸 포함)과 긴 주소(처리방침 URL 등)가 칸·화면 밖으로 넘치지 않는다.
      expect(await page.evaluate(overflowingParenGroups, "main")).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });

    test("동의 배너 문구의 '(' 뒤에서 줄이 바뀌지 않는다", async ({ page }) => {
      await page.goto("/");
      await expect(banner(page)).toBeVisible();
      await settle(page);
      const selector = "section[aria-labelledby]:has(input[type=checkbox])";
      expect(await page.evaluate(orphanedOpenParens, selector)).toEqual([]);
      expect(await page.evaluate(unguardedOpenParens, selector)).toEqual([]);
      expect(await page.evaluate(overflowingParenGroups, selector)).toEqual([]);
    });

    test("홈: 괄호 묶음이 칸 밖으로 넘치지 않고 '(' 뒤에서 줄이 바뀌지 않는다", async ({ page }) => {
      await page.goto("/");
      await settle(page);
      expect(await page.evaluate(orphanedOpenParens, "main")).toEqual([]);
      expect(await page.evaluate(overflowingParenGroups, "main")).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  });
}

test("/privacy에서는 동의 배너를 띄우지 않고, 같은 동의를 고르는 통계 설정 카드가 있다", async ({ page }) => {
  await page.goto("/privacy");
  const card = page.getByRole("region", { name: "통계 설정" });
  await expect(card).toBeVisible();
  await expect(card.getByRole("switch", { name: "이용 통계 수집·이용 동의" })).toBeVisible();
  await expect(banner(page)).toHaveCount(0);
  await page.waitForTimeout(500); // 늦게 뜨는 배너가 없는지(수화 뒤)
  await expect(banner(page)).toHaveCount(0);
  // /privacy로 처음 들어와 선택하지 않고 홈으로 가면(전체 이동) 아직 안 골랐으니 그때는 배너가 뜬다.
  await page.goto("/");
  await expect(banner(page)).toBeVisible();
});

test("다른 화면의 배너 링크는 /privacy의 통계 설정으로 가고, 거기서 고른다", async ({ page }) => {
  await page.goto("/");
  await expect(banner(page)).toBeVisible();
  await banner(page).getByRole("link", { name: "개인정보 처리방침의 통계 설정" }).click();
  await expect(page).toHaveURL(/\/privacy#analytics-settings$/);
  await expect(page.getByRole("heading", { level: 2, name: "통계 설정" })).toBeInViewport();
  await expect(banner(page)).toHaveCount(0);
  // 거기서 고르면 다른 화면에서도 다시 묻지 않는다.
  await page.getByRole("switch", { name: "이용 통계 수집·이용 동의" }).click();
  await page.goto("/");
  await expect(banner(page)).toHaveCount(0);
});
