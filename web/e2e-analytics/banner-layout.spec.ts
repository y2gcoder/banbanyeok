import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { horizontalOverflow, smallInputFonts, smallTouchTargets } from "../e2e/support/layout";
import { VIEWPORTS } from "../e2e/support/viewports";

/**
 * 통계 동의 배너의 반응형 배치(U1). 배너는 통계 키가 있는 빌드에서만 뜨므로 이 설정(playwright.analytics.config.ts)에서 본다.
 * 화면 아래에 붙어 있어도 (a) 화면 높이의 60%를 넘게 가리지 않고 (b) 두 버튼이 늘 화면 안에서 눌리며 (c) 가로로 넘치지 않는다.
 * 높이가 짧은 가로 화면에서는 안내가 배너 안에서 스크롤된다. 배너는 원래 본문 위에 떠 있으므로 겹침 검사는 하지 않는다
 * (배너 아래 본문은 e2e/responsive.spec.ts가 배너 없이 검사한다).
 */
const shotsDir = resolve(import.meta.dirname, "../../docs/setup/u1-screens/consent-banner");

const banner = (page: Page) => page.getByRole("region", { name: /이용 통계를 모아도 될까요/ });

const CASES = VIEWPORTS.filter((v) =>
  ["phone-320", "fold-cover-344", "land-568", "land-863", "fold-open-690", "desktop-1280", "zoom200-1280"].includes(
    v.id,
  ),
);

for (const vp of CASES) {
  test.describe(`${vp.id} (${vp.width}×${vp.height})`, () => {
    test.use({
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.touch,
      hasTouch: vp.touch,
      deviceScaleFactor: vp.scale ?? (vp.touch ? 2 : 1),
    });

    test("배너가 화면을 다 가리지 않고 두 버튼이 화면 안에서 눌린다", async ({ page }) => {
      await page.goto("/");
      await expect(banner(page)).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      if (process.env.UPDATE_SCREENSHOTS) {
        mkdirSync(shotsDir, { recursive: true });
        await page.screenshot({ path: resolve(shotsDir, `${vp.id}.png`), scale: "css" });
      }
      const box = await banner(page).boundingBox();
      expect(box?.height ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(vp.height * 0.6 + 24); // 카드 60dvh + 바깥 여백
      const buttons = [
        banner(page).getByRole("button", { name: "모두 거부" }),
        banner(page).getByRole("button", { name: "선택한 대로 저장" }),
      ];
      for (const button of buttons) {
        await expect(button).toBeInViewport({ ratio: 1 });
        await button.click({ trial: true });
      }
      expect.soft(await horizontalOverflow(page), "가로 넘침").toEqual([]);
      if (vp.touch) {
        expect.soft(await smallTouchTargets(page), "44px보다 작은 터치 목표").toEqual([]);
        expect.soft(await smallInputFonts(page), "16px보다 작은 입력 글자").toEqual([]);
      }
      // 안내가 길어 배너 안에서 스크롤돼도 체크박스까지 닿는다.
      const lastBox = banner(page).getByRole("checkbox").last();
      await lastBox.scrollIntoViewIfNeeded();
      await lastBox.click({ trial: true });
    });
  });
}

test.describe("화면 키보드", () => {
  test.use({ viewport: { width: 412, height: 839 }, isMobile: true, hasTouch: true });

  test("글자 칸을 치는 동안 배너가 숨고, 키보드가 내려가면 다시 보인다", async ({ page }) => {
    // 크로미움 자동화에는 화면 키보드가 없다. visualViewport 높이를 줄여 키보드가 올라온 상태를 흉내 낸다.
    await page.addInitScript(() => {
      const real = window.visualViewport;
      const fake = Object.assign(new EventTarget(), {
        height: real?.height ?? 839,
        scale: 1,
        width: real?.width ?? 412,
      });
      Object.defineProperty(window, "visualViewport", { configurable: true, value: fake });
      Object.assign(window, {
        __keyboard(open: boolean) {
          fake.height = open ? 420 : document.documentElement.clientHeight;
          fake.dispatchEvent(new Event("resize"));
        },
      });
    });
    await page.goto("/");
    await expect(banner(page)).toBeVisible();
    const field = page.getByRole("combobox").first();
    await field.click();
    await page.evaluate(() => (window as unknown as { __keyboard: (open: boolean) => void }).__keyboard(true));
    await expect(banner(page)).toBeHidden();
    await field.fill("강남");
    await expect(field).toBeInViewport();
    await page.evaluate(() => (window as unknown as { __keyboard: (open: boolean) => void }).__keyboard(false));
    await page.keyboard.press("Escape"); // 자동완성 목록을 닫고
    await field.blur(); // 초점이 칸을 떠난다
    await expect(banner(page)).toBeVisible();
  });
});
