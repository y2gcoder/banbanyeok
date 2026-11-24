import { expect, type Locator, type Page } from "@playwright/test";
import { clippedText, horizontalOverflow, overlaps, smallInputFonts, smallTouchTargets } from "./layout";

/**
 * 한 화면의 배치 검사 묶음: (a) 가로 넘침 없음 (b) 주요 버튼이 보이고 눌림 (c) 겹침·잘림 없음,
 * 터치 기기면 터치 목표 44px·입력 글자 16px 이상. 문제는 모아서(soft) 한 번에 보여 준다.
 */
export async function checkLayout(page: Page, actions: readonly Locator[], touch: boolean) {
  expect.soft(await horizontalOverflow(page), "가로 넘침").toEqual([]);
  expect.soft(await overlaps(page), "겹침").toEqual([]);
  expect.soft(await clippedText(page), "잘린 글자").toEqual([]);
  if (touch) {
    expect.soft(await smallTouchTargets(page), "44px보다 작은 터치 목표").toEqual([]);
    expect.soft(await smallInputFonts(page), "16px보다 작은 입력 글자(iOS 확대)").toEqual([]);
  }
  for (const action of actions) {
    await action.scrollIntoViewIfNeeded();
    await expect.soft(action).toBeVisible();
    // trial: 실제로 누르지는 않고, 보이고·움직이지 않고·다른 것에 가려지지 않아 눌릴 수 있는지만 확인한다.
    await action.click({ trial: true, timeout: 3000 });
  }
}

/** 두 칸 폭(wide = 40rem)인지. rem 미디어 쿼리라 브라우저 기본 글자 크기를 키우면 경계도 커진다. */
export const isWide = (page: Page) => page.evaluate(() => matchMedia("(min-width: 40rem)").matches);

/**
 * 두 요소의 배치: 두 칸 폭이면 나란히(오른쪽 것이 왼쪽 것의 오른쪽에서 시작), 아니면 위아래(아래 것이 위 것 밑에서 시작).
 */
export async function expectColumns(page: Page, first: Locator, second: Locator) {
  const [a, b] = await Promise.all([first.boundingBox(), second.boundingBox()]);
  if (!a || !b) throw new Error("칸을 찾지 못했어요");
  if (await isWide(page)) {
    expect.soft(b.x, "두 칸: 오른쪽 칸이 왼쪽 칸 옆에서 시작").toBeGreaterThanOrEqual(a.x + a.width - 1);
  } else {
    expect.soft(b.y, "한 칸: 아래 것이 위 것 밑에서 시작").toBeGreaterThanOrEqual(a.y + a.height - 1);
  }
}

/**
 * 왼쪽 칸(side)과 결과(main): 두 칸 폭이면 side가 왼쪽, 한 칸(폰)이면 결과가 먼저이고 side가 그 아래(#168: 결과가 있는 방은
 * 폰 첫 화면에 1위를 둔다).
 */
export async function expectSideBesideOrBelowMain(page: Page, side: Locator, main: Locator) {
  if (await isWide(page)) await expectColumns(page, side, main);
  else await expectColumns(page, main, side);
}
