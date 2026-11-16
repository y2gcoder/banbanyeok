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
        banner(page).getByRole("button", { name: "이대로 닫기" }),
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

/**
 * U2: 폰에서 배너가 화면 아래를 크게 가리지 않는다. 안내는 짧게, 두 버튼은 한 줄로 같은 크기, 체크박스 설명·철회 안내는 폰에서도 보인다.
 * 맨 아래까지 스크롤하면 본문의 마지막 줄이 배너 위에 온다(배너는 문서 끝에 있어 본문 아래에 자기 자리가 있다).
 */
const u2ShotsDir = resolve(import.meta.dirname, "../../docs/setup/u2-screens");
const U2_CASES = [
  { id: "phone-390x844", width: 390, height: 844, touch: true, maxShare: 0.35 },
  { id: "fold-cover-344", width: 344, height: 882, touch: true, maxShare: 0.45 },
  { id: "fold-open-690", width: 690, height: 829, touch: true, maxShare: 0.3 },
  { id: "desktop-1280", width: 1280, height: 800, touch: false, maxShare: 0.35 },
] as const;

for (const vp of U2_CASES) {
  test.describe(`U2 ${vp.id}`, () => {
    test.use({
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.touch,
      hasTouch: vp.touch,
      deviceScaleFactor: vp.touch ? 2 : 1,
    });

    test(`배너가 화면의 ${vp.maxShare * 100}% 이하이고 버튼은 같은 크기로 한 줄에 있다`, async ({ page }) => {
      await page.goto("/");
      await expect(banner(page)).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      if (process.env.UPDATE_SCREENSHOTS) {
        mkdirSync(resolve(u2ShotsDir, vp.id), { recursive: true });
        await page.screenshot({ path: resolve(u2ShotsDir, vp.id, "4-consent-banner.png"), scale: "css" });
      }
      const box = await banner(page).boundingBox();
      expect(box?.height ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(vp.height * vp.maxShare);

      // 선택 동등성: 거부와 저장은 같은 크기·같은 줄이다.
      const reject = await banner(page).getByRole("button", { name: "모두 거부" }).boundingBox();
      const save = await banner(page).getByRole("button", { name: "이대로 닫기" }).boundingBox();
      expect(reject?.width).toBeCloseTo(save?.width ?? -1, 0);
      expect(reject?.height).toBeCloseTo(save?.height ?? -1, 0);
      expect(reject?.y).toBeCloseTo(save?.y ?? -1, 0);
      // 두 체크박스는 기본 해제로 둘 다 화면 안에서 눌린다.
      for (const box of await banner(page).getByRole("checkbox").all()) {
        await expect(box).not.toBeChecked();
        await expect(box).toBeInViewport({ ratio: 1 });
      }
      // W1: 체크박스는 위아래 한 줄씩이다(같은 x, 아래 것이 더 아래).
      if (vp.width < 690) {
        const [first, second] = await Promise.all(
          (await banner(page).getByRole("checkbox").all()).map((box) => box.boundingBox()),
        );
        expect(first?.x).toBeCloseTo(second?.x ?? -1, 0);
        expect(second?.y ?? 0).toBeGreaterThan((first?.y ?? 0) + (first?.height ?? 0));
      }
      expect.soft(await horizontalOverflow(page), "가로 넘침").toEqual([]);
      if (vp.touch) expect.soft(await smallTouchTargets(page), "44px보다 작은 터치 목표").toEqual([]);
    });

    test("하나만 체크하면 안내가 보여도 배너 높이와 체크박스 위치가 변하지 않고, 버튼은 같은 크기·같은 줄이다", async ({
      page,
    }) => {
      await page.goto("/");
      await expect(banner(page)).toBeVisible();
      const firstBox = banner(page).getByRole("checkbox").first();
      const before = { banner: await banner(page).boundingBox(), box: await firstBox.boundingBox() };
      await firstBox.check();
      await expect(banner(page).getByText("두 가지 모두 체크해야 통계를 모아요.")).toBeVisible();
      const after = { banner: await banner(page).boundingBox(), box: await firstBox.boundingBox() };
      // 안내 줄 자리를 미리 잡아 두므로 하단 고정 배너가 커지며 체크박스를 위로 밀지 않는다.
      expect(after.banner?.height).toBeCloseTo(before.banner?.height ?? -1, 0);
      expect(after.box?.y).toBeCloseTo(before.box?.y ?? -1, 0);
      const reject = await banner(page).getByRole("button", { name: "모두 거부" }).boundingBox();
      const save = await banner(page).getByRole("button", { name: "이대로 닫기" }).boundingBox();
      expect(reject?.width).toBeCloseTo(save?.width ?? -1, 0);
      expect(reject?.height).toBeCloseTo(save?.height ?? -1, 0);
      expect(reject?.y).toBeCloseTo(save?.y ?? -1, 0);
      await banner(page).getByRole("checkbox").last().check();
      await expect(banner(page).getByRole("button", { name: "동의하고 닫기", exact: true })).toBeVisible();
      await expect(banner(page).getByText("두 가지 모두 체크해야 통계를 모아요.")).toBeHidden();
    });

    test("맨 아래까지 스크롤하면 본문 마지막 줄이 배너에 가려지지 않는다", async ({ page }) => {
      await page.goto("/");
      await expect(banner(page)).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const last = page.getByRole("link", { name: /방 만들어서 각자 입력하기/ });
      await expect(last).toBeInViewport({ ratio: 1 });
      const lastBox = await last.boundingBox();
      const bannerBox = await banner(page).boundingBox();
      expect(lastBox && bannerBox ? lastBox.y + lastBox.height <= bannerBox.y + 1 : false).toBe(true);
      await last.click({ trial: true }); // 다른 요소가 가로채지 않는다
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
