import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { horizontalOverflow } from "./support/layout";

// #68: "지도 한가운데였다면?" 비교(결과 화면 표, 공유 링크의 미리보기 문구·그림 주소). 가짜 서버(mock/recommend.ts)는 실제 서버의
// 규칙(공평 기준·1위와 다른 역·가장 오래 걸리는 시간이 5분 이상 늘 때)을 흉내 낸다. 수유 + 홍대입구가 비교가 붙는 조합이다.

const stationIndex = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../src/lib/stations/index.gen.json"), "utf8"),
) as { stations: [string, string, ...unknown[]][] };
const code = (name: string): string => {
  const found = stationIndex.stations.find((s) => s[1] === name);
  if (!found) throw new Error(`역 없음: ${name}`);
  return found[0];
};
const WITH_MIDDLE = `v=2&o=${code("수유")}.${code("홍대입구")}&m=f&t=weekday-day`;
const WITHOUT_MIDDLE = `v=2&o=${code("강남")}.${code("홍대입구")}&m=f&t=weekday-day`;
const meta = (page: Page, selector: string) => page.locator(selector).first().getAttribute("content");

async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

test("결과 화면: 1위 카드 안에 비교 표가 있고 마지막 줄은 '가장 오래'이며 360px에서도 넘치지 않는다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`/result?${WITH_MIDDLE}`);
  const top = page.getByRole("article").first();
  // 1위 카드의 "자세히" 안에 있다(#122).
  await top.getByRole("button", { name: /자세히/ }).click();
  const table = top.getByRole("table");
  await expect(table).toBeVisible();
  await expect(top.getByRole("heading", { name: "지도 한가운데였다면?" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: /추천/ })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: /지도 한가운데\s*경복궁/ })).toBeVisible();
  const rows = table.getByRole("row");
  await expect(rows).toHaveCount(4); // 머리 + 두 사람 + 가장 오래
  await expect(rows.last().getByRole("rowheader")).toHaveText("가장 오래");
  await expect(table.getByText("차이")).toHaveCount(0);
  await expect(top.getByText(/^지도 한가운데인 경복궁역이면 .+ 더 걸려요$/)).toBeVisible();
  expect(await horizontalOverflow(page)).toEqual([]);
  await expectAccessible(page);
});

test("결과 화면: 조건을 채우지 못하면(가까운 조합·빠른 기준) 표가 없다", async ({ page }) => {
  await page.goto(`/result?${WITHOUT_MIDDLE}`);
  await expect(page.getByRole("article").first()).toBeVisible();
  await page
    .getByRole("article")
    .first()
    .getByRole("button", { name: /자세히/ })
    .click();
  await expect(page.getByRole("table")).toHaveCount(0);
  await page.goto(`/result?${WITH_MIDDLE.replace("m=f", "m=q")}`);
  await expect(page.getByRole("article").first()).toBeVisible();
  await page
    .getByRole("article")
    .first()
    .getByRole("button", { name: /자세히/ })
    .click();
  await expect(page.getByRole("table")).toHaveCount(0);
});

test("받은 링크(/s): 옛 링크(v=1)도 열리고, 미리보기 설명에 비교 문장이 들어가며, 그림 주소에 디자인 버전이 붙는다", async ({
  page,
  baseURL,
}) => {
  await page.goto(`/s?${WITH_MIDDLE}`);
  expect(await meta(page, 'meta[name="description"]')).toMatch(/ · 지도 한가운데인 경복궁역이면 .+ 더 걸려요$/);
  const ogImage = (await meta(page, 'meta[property="og:image"]')) ?? "";
  expect(ogImage).toMatch(new RegExp(`^${baseURL}/s/og\\?v=2&o=.+&dv=[^&]+&iv=[0-9a-f]{8}$`));
  const png = await page.request.get(ogImage);
  expect(png.status()).toBe(200);
  expect(png.headers()["content-type"]).toBe("image/png");
  await page
    .getByRole("article")
    .first()
    .getByRole("button", { name: /자세히/ })
    .click();
  await expect(page.getByRole("table")).toBeVisible();

  // 옛 링크(v=1: 구분을 고른 적 없음 = 평일 낮으로 계산). 그림 주소도 v=1 그대로다(`t`를 붙여 구분을 고른 요청으로 바꾸지 않는다).
  await page.goto(`/s?v=1&o=${code("수유")}.${code("홍대입구")}&m=f`);
  await page
    .getByRole("article")
    .first()
    .getByRole("button", { name: /자세히/ })
    .click();
  await expect(page.getByRole("table")).toBeVisible();
  const legacyImage = (await meta(page, 'meta[property="og:image"]')) ?? "";
  expect(legacyImage).toMatch(new RegExp(`^${baseURL}/s/og\\?v=1&o=[^&]+&m=f&dv=[^&]+&iv=[0-9a-f]{8}$`));
  expect((await page.request.get(legacyImage)).headers()["content-type"]).toBe("image/png");

  // 비교가 없는 링크: 설명은 그대로이고 표가 없다.
  await page.goto(`/s?${WITHOUT_MIDDLE}`);
  expect(await meta(page, 'meta[name="description"]')).not.toContain("지도 한가운데");
  await page
    .getByRole("article")
    .first()
    .getByRole("button", { name: /자세히/ })
    .click();
  await expect(page.getByRole("table")).toHaveCount(0);
});
