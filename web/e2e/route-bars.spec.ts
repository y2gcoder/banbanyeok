import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { checkLayout } from "./support/checks";

// #120: '자세히'의 사람별 막대가 노선 색 구간 + 회색(기다림·갈아타기)으로 나뉘고, 막대 대신 읽을 경로 글과 사람별 카카오맵 길찾기가 붙는다.
// 가짜 서버(mock/recommend.ts)는 같은 노선이면 한 구간, 아니면 두 노선이 함께 서는 역에서 갈아타는 경로를 준다.
// SHOTS_DIR을 주면 폰(390×844) 캡처를 그 폴더에 남긴다(PR 증거용, 저장소에는 넣지 않는다).

const stationIndex = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../src/lib/stations/index.gen.json"), "utf8"),
) as { stations: [string, string, ...unknown[]][] };
const code = (name: string): string => {
  const found = stationIndex.stations.find((s) => s[1] === name);
  if (!found) throw new Error(`역 없음: ${name}`);
  return found[0];
};

async function shot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: resolve(dir, `${name}.png`), fullPage: true, scale: "css" });
}

test("폰: 1위 '자세히'의 막대가 노선 색으로 나뉘고, 경로 글·길찾기가 있고, 넘치거나 겹치지 않는다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/result?v=2&o=${code("혜화")}.${code("강남")}.${code("홍대입구")}&m=f&t=weekday-day`);
  const top = page.getByRole("article").first();
  await top.getByRole("button", { name: /자세히/ }).click();
  const routed = top.locator('[data-route="lines"]');
  await expect(routed.first()).toBeAttached();
  expect(await routed.first().getAttribute("aria-hidden")).toBe("true");
  expect(await routed.first().locator('[data-segment="ride"]').count()).toBeGreaterThan(0);
  await expect(top.getByText(/경로: .+/).first()).toBeAttached();
  await expect(top.getByRole("link", { name: /카카오맵 길찾기$/ }).first()).toHaveAttribute(
    "href",
    /^https:\/\/map\.kakao\.com\/link\/by\/traffic\//,
  );
  await expect(top.getByText(/막대 색은 타는 노선/)).toBeVisible();
  await checkLayout(page, [top.getByRole("link", { name: /카카오맵 길찾기$/ }).first()], true);
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  await top.scrollIntoViewIfNeeded();
  await shot(page, "stateless-detail");
});

test("경로를 모르는 사람(가짜 서버가 갈아탈 역을 못 찾음)은 중립색 막대로 남는다", async ({ page }) => {
  await page.goto(`/result?v=2&o=${code("혜화")}.${code("강남")}.${code("홍대입구")}&m=f&t=weekday-day`);
  const top = page.getByRole("article").first();
  await top.getByRole("button", { name: /자세히/ }).click();
  const tracks = top.locator("[data-route]");
  const kinds = await tracks.evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-route")));
  // 사람마다 막대는 하나이고, 경로 글은 경로가 있는 사람 수만큼이다.
  expect(kinds.length).toBe(3);
  expect(await top.getByText(/경로: .+/).count()).toBe(kinds.filter((k) => k === "lines").length);
});
