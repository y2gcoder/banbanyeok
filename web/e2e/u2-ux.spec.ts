import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { horizontalOverflow } from "./support/layout";
import { prepareRoom, ROOM_BASIS } from "./support/room-fixture";

/**
 * U2 운영 QA 회귀: ① 결과 → "다시 입력"이 모든 입력(출발역·이름·구분·모드)을 되살린다 ② 역 자동완성에서 하이라이트된 항목과 Enter가
 * 고르는 항목이 같다(정확 일치가 첫 후보) ③ 방 참여 화면도 서버가 준 계산 기준 문구를 보여 준다.
 * UPDATE_SCREENSHOTS=1이면 docs/setup/u2-screens/에 폰(390×844)·폴드 접힘·폴드 펼침·데스크톱 캡처를 남긴다.
 */
const shotsDir = resolve(import.meta.dirname, "../../docs/setup/u2-screens");

const SCREEN_SIZES = [
  { id: "phone-390x844", width: 390, height: 844, touch: true },
  { id: "fold-cover-344", width: 344, height: 882, touch: true },
  { id: "fold-open-690", width: 690, height: 829, touch: true },
  { id: "desktop-1280", width: 1280, height: 800, touch: false },
] as const;

async function shot(page: Page, size: string, name: string) {
  if (!process.env.UPDATE_SCREENSHOTS) return;
  mkdirSync(resolve(shotsDir, size), { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve(shotsDir, size, `${name}.png`), scale: "css" });
}

/** 역 칸에 치고 보이는 후보에서 고른다. */
async function pickStation(page: Page, field: Locator, query: string, option: RegExp) {
  await field.fill(query);
  await page.getByRole("option", { name: option }).click();
}

/** 혜화 + 강남, 토요일 밤으로 결과까지 간다(운영 QA 재현 순서). */
async function reachResult(page: Page) {
  await page.goto("/");
  await page.getByRole("textbox", { name: "1번째 사람 이름(선택)" }).fill("민수");
  await pickStation(page, page.getByRole("combobox", { name: "민수의 출발역" }), "혜화", /^혜화\s?4호선/);
  await pickStation(page, page.getByRole("combobox", { name: "친구1의 출발역" }), "강남", /^강남\s?2호선/);
  await page.getByRole("radio", { name: "토요일" }).click();
  await page.getByRole("radio", { name: /^밤/ }).click();
  await page.getByRole("button", { name: "만날 역 찾기" }).click();
  await expect(page).toHaveURL(/\/result\?v=2&o=[0-9a-z]{3}\.[0-9a-z]{3}&m=f&t=saturday-night&n=/);
  await expect(page.getByRole("article").first()).toBeVisible();
}

test.describe("다시 입력: 입력이 모두 되돌아온다", () => {
  test("혜화+강남, 토요일 밤 → 결과 → 다시 입력: 이름·두 출발역·구분이 그대로", async ({ page }) => {
    await reachResult(page);
    await page.getByRole("link", { name: "다시 입력" }).click();
    await expect(page).toHaveURL(/\/\?v=2&o=/);

    await expect(page.getByRole("textbox", { name: "1번째 사람 이름(선택)" })).toHaveValue("민수");
    await expect(page.getByRole("combobox", { name: "민수의 출발역" })).toHaveValue("혜화");
    await expect(page.getByRole("combobox", { name: "친구1의 출발역" })).toHaveValue("강남");
    // 지금 시각의 기본값이 아니라 직전에 고른 구분이다.
    await expect(page.getByRole("radio", { name: "토요일" })).toBeChecked();
    await expect(page.getByRole("radio", { name: /^밤/ })).toBeChecked();
    await expect(page.getByText(/지금 시각으로 골라 뒀어요/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "만날 역 찾기" })).toBeEnabled();
  });

  test("바꾼 기준(모드)도 이어진다: 빨리 만나기로 보다 돌아와 그대로 다시 찾으면 같은 모드", async ({ page }) => {
    await reachResult(page);
    await page.getByRole("tab", { name: "빨리 만나기" }).click();
    await expect(page).toHaveURL(/m=q/);
    await page.getByRole("link", { name: "다시 입력" }).click();
    await expect(page.getByRole("combobox", { name: "민수의 출발역" })).toHaveValue("혜화");
    await page.getByRole("button", { name: "만날 역 찾기" }).click();
    await expect(page).toHaveURL(/\/result\?v=2&o=[0-9a-z]{3}\.[0-9a-z]{3}&m=q&t=saturday-night&n=/);
  });

  test("돌아와서 한 줄만 바꾸면 나머지는 남는다", async ({ page }) => {
    await reachResult(page);
    await page.getByRole("link", { name: "다시 입력" }).click();
    const second = page.getByRole("combobox", { name: "친구1의 출발역" });
    await expect(second).toHaveValue("강남");
    await second.fill("잠실");
    await page.getByRole("option", { name: /^잠실\s?2호선/ }).click();
    await expect(page.getByRole("combobox", { name: "민수의 출발역" })).toHaveValue("혜화");
    await page.getByRole("button", { name: "만날 역 찾기" }).click();
    await expect(page).toHaveURL(/t=saturday-night/);
  });
});

test.describe("역 자동완성 키보드", () => {
  test("'강남': 정확 일치가 첫 후보이고, 하이라이트된 항목을 Enter가 고른다", async ({ page }) => {
    await page.goto("/");
    const field = page.getByRole("combobox", { name: "나의 출발역" });
    await field.fill("강남");
    const options = page.getByRole("option");
    await expect(options.first()).toContainText("강남");
    await expect(options.first()).not.toContainText("강남대");
    await expect(options.first()).not.toContainText("강남구청");
    // 처음부터 첫 후보가 하이라이트이고 aria-activedescendant가 그 항목을 가리킨다.
    await expect(options.first()).toHaveAttribute("data-highlighted", "");
    const firstId = await options.first().getAttribute("id");
    await expect(field).toHaveAttribute("aria-activedescendant", firstId ?? "");
    await page.keyboard.press("Enter");
    await expect(field).toHaveValue("강남");
  });

  test("ArrowDown은 한 칸 아래(둘째 후보)로 옮기고, 그때 하이라이트·activedescendant·Enter가 모두 같은 항목이다", async ({
    page,
  }) => {
    await page.goto("/");
    const field = page.getByRole("combobox", { name: "나의 출발역" });
    await field.fill("강남");
    const options = page.getByRole("option");
    await expect(options.first()).toHaveAttribute("data-highlighted", "");
    await page.keyboard.press("ArrowDown");
    const second = options.nth(1);
    await expect(second).toHaveAttribute("data-highlighted", "");
    await expect(options.first()).not.toHaveAttribute("data-highlighted", "");
    const secondId = await second.getAttribute("id");
    await expect(field).toHaveAttribute("aria-activedescendant", secondId ?? "");
    await expect(second).toContainText("강남대");
    await page.keyboard.press("Enter");
    await expect(field).toHaveValue("강남대");
  });

  test("이미 역을 고른 칸에 다른 이름을 새로 쳐도 고른 역이 첫 후보에 끼어들지 않는다", async ({ page }) => {
    await page.goto("/");
    const field = page.getByRole("combobox", { name: "나의 출발역" });
    await pickStation(page, field, "혜화", /^혜화\s?4호선/);
    await field.press("ControlOrMeta+a");
    await field.pressSequentially("강남");
    await expect(page.getByRole("option").first()).toContainText("강남");
    await expect(page.getByRole("option").first()).not.toContainText("혜화");
    await page.keyboard.press("Enter");
    await expect(field).toHaveValue("강남");
  });
});

test("방 참여 화면에도 서버가 준 계산 기준 문구가 보인다", async ({ page }) => {
  const path = await prepareRoom(page, "friend-join");
  await page.goto(path);
  const form = page.getByRole("form", { name: "나도 출발역 넣기" });
  await expect(form).toBeVisible();
  await expect(form.getByText(`${ROOM_BASIS.label} 기준으로 계산해요`)).toBeVisible();
});

test.describe("캡처", () => {
  for (const size of SCREEN_SIZES) {
    test.describe(size.id, () => {
      test.use({
        viewport: { width: size.width, height: size.height },
        isMobile: size.touch,
        hasTouch: size.touch,
        deviceScaleFactor: size.touch ? 2 : 1,
      });

      test("다시 입력으로 돌아온 입력 화면", async ({ page }) => {
        await reachResult(page);
        await shot(page, size.id, "2-result");
        await page.getByRole("link", { name: "다시 입력" }).click();
        await expect(page.getByRole("combobox", { name: "친구1의 출발역" })).toHaveValue("강남");
        await page.evaluate(() => document.fonts.ready);
        expect(await horizontalOverflow(page)).toEqual([]);
        await shot(page, size.id, "1-home-restored");
      });

      test("방 참여 화면(계산 기준 문구)", async ({ page }) => {
        await page.goto(await prepareRoom(page, "friend-join"));
        const form = page.getByRole("form", { name: "나도 출발역 넣기" });
        await expect(form.getByText(`${ROOM_BASIS.label} 기준으로 계산해요`)).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        expect(await horizontalOverflow(page)).toEqual([]);
        await shot(page, size.id, "3-room-join");
      });
    });
  }
});
