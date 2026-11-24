import type { Locator, Page } from "@playwright/test";
import { checkLayout, expectColumns, expectSideBesideOrBelowMain } from "../e2e/support/checks";
import { VIEWPORTS } from "../e2e/support/viewports";

/**
 * 실제 서버 응답으로 그린 방 화면을 대표 기기 크기로 바꿔 가며 배치를 확인한다(U1). 기본 e2e(e2e/responsive.spec.ts)가 방 API를
 * 흉내 내 전체 기기 행렬을 보고, 여기서는 이미 만든 방을 그대로 쓴다: 방 만들기·참여는 IP당 버스트 제한이 있어(r1-notes 8절)
 * 이 검사 때문에 방을 더 만들지 않는다. 컨텍스트가 터치 기기(Pixel 7)라 데스크톱 크기에서도 터치 기준(44px·16px)으로 본다.
 */
const SIZES = VIEWPORTS.filter((v) =>
  [
    "phone-320",
    "fold-cover-344",
    "fold-open-690",
    "fold-open-1028-land",
    "land-863",
    "desktop-1280",
    "zoom200-1280",
  ].includes(v.id),
);

export async function sweepViewports(
  page: Page,
  actions: (page: Page) => Locator[],
  columns: (page: Page) => [Locator, Locator],
  /** 좁으면 결과(오른쪽 칸)가 왼쪽 칸 대표 요소보다 먼저 온다(결과가 있는 방, #168). */
  { resultFirstOnPhone = false }: { resultFirstOnPhone?: boolean } = {},
) {
  const original = page.viewportSize();
  for (const size of SIZES) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await checkLayout(page, actions(page), true);
    const [side, main] = columns(page);
    if (resultFirstOnPhone) await expectSideBesideOrBelowMain(page, side, main);
    else await expectColumns(page, side, main);
  }
  if (original) await page.setViewportSize(original);
}
