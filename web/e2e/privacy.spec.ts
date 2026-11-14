import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { encodeShareQuery } from "../src/lib/link/codec";

// 개인정보 처리방침 페이지와, 입력 화면·받은 링크 화면 하단의 링크.

async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

const footerLink = (page: Page) =>
  page.getByRole("navigation", { name: "사이트 정보" }).getByRole("link", { name: "개인정보 처리방침" });

test("처리방침: 열림, 초안 경고, 목차와 필수 제목, 접근성 위반 0", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page).toHaveTitle(/개인정보 처리방침/);
  await expect(page.getByRole("heading", { level: 1, name: "반반역 개인정보 처리방침" })).toBeVisible();
  await expect(page.getByRole("note")).toContainText("변호사의 검토를 받아야 합니다");
  expect(await page.locator('meta[name="robots"]').first().getAttribute("content")).toContain("noindex");

  for (const name of [
    "1. 개인정보의 처리 목적",
    "2. 처리하는 개인정보의 항목과 법적 근거",
    "4. 개인정보의 처리 및 보유 기간",
    "7. 개인정보 처리업무의 위탁과 국외 이전",
    "8. 정보주체와 법정대리인의 권리·의무 및 행사 방법",
    "11. 개인정보 자동 수집 장치(쿠키 등)의 설치·운영 및 거부",
    "13. 개인정보 보호책임자",
    "15. 개인정보 처리방침의 변경과 시행일",
  ]) {
    await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
  }

  // 목차 링크가 해당 절로 이동한다.
  await page
    .getByRole("navigation", { name: "목차" })
    .getByRole("link", { name: "7. 개인정보 처리업무의 위탁과 국외 이전" })
    .click();
  await expect(page).toHaveURL(/#outsourcing$/);
  await expect(
    page.getByRole("heading", { level: 2, name: "7. 개인정보 처리업무의 위탁과 국외 이전" }),
  ).toBeInViewport();

  // 모바일에서는 표가 카드 목록으로 보인다(가로 스크롤 없음).
  await expect(page.getByRole("list", { name: "개인정보의 국외 이전" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expectAccessible(page);
});

test("처리방침: 넓은 화면에서는 표로 보이고 접근성 위반 0", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto("/privacy");
  await expect(page.getByRole("table", { name: "개인정보의 국외 이전" })).toBeVisible();
  await expect(page.getByRole("list", { name: "개인정보의 국외 이전" })).toBeHidden();
  await expectAccessible(page);
});

test("입력 화면 하단에 처리방침 링크가 있다", async ({ page }) => {
  await page.goto("/");
  const link = footerLink(page);
  await link.scrollIntoViewIfNeeded();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/privacy$/);
});

test("받은 링크 화면 하단에 처리방침 링크가 있다", async ({ page }) => {
  // 데이터에 의존하지 않게 SEO 허브의 첫 조합에서 실제 역 코드를 가져온다.
  await page.goto("/meet");
  const href = await page.locator('a[href^="/meet/"]').first().getAttribute("href");
  const [a, b] = (href ?? "").replace("/meet/", "").split("-");
  if (!a || !b) throw new Error("허브에 조합 링크가 없습니다");

  await page.goto(`/s?${encodeShareQuery({ origins: [a, b], mode: "fair", favorIndex: null, nicknames: null })}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const link = footerLink(page);
  await link.scrollIntoViewIfNeeded();
  await expect(link).toBeVisible();
  await expectAccessible(page);
});
