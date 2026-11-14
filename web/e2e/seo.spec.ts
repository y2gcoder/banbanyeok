import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

// SEO 페이지(조합·허브), 사이트맵·robots, 정적/동적 OG 이미지. 특정 조합·문장에 의존하지 않는다(데이터는 파이프라인이 다시 만든다):
// 허브에서 첫 조합 링크를 따라간다. 빌드의 SITE_URL은 playwright.config.ts가 baseURL과 같게 둔다(localhost류 → 색인 막힘).

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

async function firstPairPath(page: Page): Promise<string> {
  await page.goto("/meet");
  const href = await page.locator('a[href^="/meet/"]').first().getAttribute("href");
  if (!href) throw new Error("허브에 조합 링크가 없습니다");
  return href;
}

async function expectOgPng(page: Page, url: string) {
  const response = await page.request.get(url);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("image/png");
  const bytes = await response.body();
  expect([...bytes.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
  expect(bytes.readUInt32BE(16)).toBe(1200);
  expect(bytes.readUInt32BE(20)).toBe(630);
}

const meta = (page: Page, selector: string) => page.locator(selector).first().getAttribute("content");

test("허브 → 조합 페이지: 후보 3곳, 메타데이터, 정적 OG 이미지, 다시 찾기", async ({ page, baseURL }) => {
  const path = await firstPairPath(page);
  expect(path).toMatch(/^\/meet\/[0-9a-z]{3}-[0-9a-z]{3}$/);

  await page.goto("/meet");
  await expect(page.getByRole("heading", { level: 1, name: "인기 역 조합별 만날 곳" })).toBeVisible();
  await expectAccessible(page);

  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("중간 만날 곳 추천");
  await expect(page.getByRole("article")).toHaveCount(3);
  await expect(page.getByRole("contentinfo")).toContainText("데이터 기준");
  await expectAccessible(page);

  // 메타데이터: 제목·설명·canonical·Open Graph·Twitter. 이 e2e 빌드는 SITE_URL이 127.0.0.1이라 색인 막힘.
  await expect(page).toHaveTitle(/중간 만날 곳 추천 3곳 \| 반반역$/);
  expect((await meta(page, 'meta[name="description"]'))?.length).toBeGreaterThan(30);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${baseURL}${path}`);
  expect(await meta(page, 'meta[property="og:url"]')).toBe(`${baseURL}${path}`);
  expect(await meta(page, 'meta[property="og:type"]')).toBe("website");
  expect(await meta(page, 'meta[property="og:locale"]')).toBe("ko_KR");
  expect(await meta(page, 'meta[name="twitter:card"]')).toBe("summary_large_image");
  expect(await meta(page, 'meta[name="robots"]')).toBe("noindex, nofollow");

  // JSON-LD(빵부스러기)
  const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').first().textContent()) ?? "{}");
  expect(ld["@type"]).toBe("BreadcrumbList");
  expect(ld.itemListElement.at(-1).item).toBe(`${baseURL}${path}`);

  // 미리보기 이미지: 빌드 때 만든 정적 PNG(1200×630)
  const ogImage = await meta(page, 'meta[property="og:image"]');
  expect(ogImage).toContain(`${path}/opengraph-image`);
  await expectOgPng(page, ogImage ?? "");
  expect(await meta(page, 'meta[name="twitter:image"]')).toBe(ogImage);

  // 반대 순서(B-A)는 만들지 않는다.
  const [a, b] = path.replace("/meet/", "").split("-");
  expect((await page.request.get(`/meet/${b}-${a}`)).status()).toBe(404);
  expect((await page.request.get("/meet/zzz-zzz")).status()).toBe(404);

  // "다른 역으로 다시 찾기": 입력 화면이 두 역으로 채워진다.
  await page.getByRole("link", { name: "다른 역으로 다시 찾기" }).click();
  await expect(page).toHaveURL(/\/\?o=[0-9a-z]{3}\.[0-9a-z]{3}$/);
  await expect(page.getByRole("combobox", { name: "나의 출발역" })).not.toHaveValue("");
  await expect(page.getByRole("combobox", { name: "친구1의 출발역" })).not.toHaveValue("");
  await expect(page.getByRole("button", { name: "만날 역 찾기" })).toBeEnabled();
});

test("sitemap.xml과 robots.txt", async ({ page, baseURL }) => {
  const path = await firstPairPath(page);
  const sitemap = await page.request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  expect(sitemap.headers()["content-type"]).toContain("xml");
  const xml = await sitemap.text();
  expect(xml).toContain(`<loc>${baseURL}/</loc>`);
  expect(xml).toContain(`<loc>${baseURL}/meet</loc>`);
  expect(xml).toContain(`<loc>${baseURL}${path}</loc>`);
  expect(xml).not.toContain("/s?");
  expect(xml).not.toContain("/result");

  // 이 빌드의 SITE_URL은 localhost류라 전부 막힌다(개발·미리보기 배포가 색인되지 않게).
  const robots = await page.request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toContain("Disallow: /");
});

test("공유 링크의 미리보기: 링크별 제목·설명과 동적 OG 이미지", async ({ page, baseURL }) => {
  const path = await firstPairPath(page);
  await page.goto(path);
  const prefill = await page.getByRole("link", { name: "다른 역으로 다시 찾기" }).getAttribute("href");
  const origins = new URL(prefill ?? "", baseURL).searchParams.get("o");
  expect(origins).toMatch(/^[0-9a-z]{3}\.[0-9a-z]{3}$/);

  const query = `v=1&o=${origins}&m=f`;
  await page.goto(`/s?${query}`);
  await expect(page).toHaveTitle(/에서 볼까\? \| 반반역$/);
  expect(await meta(page, 'meta[name="robots"]')).toBe("noindex, nofollow");
  expect(await meta(page, 'meta[name="description"]')).toMatch(/ [0-9]+분 · .+ 고름$/);
  const ogImage = (await meta(page, 'meta[property="og:image"]')) ?? "";
  expect(ogImage).toContain(`${baseURL}/s/og?${query}&dv=`);
  await expectOgPng(page, ogImage);

  // 별칭에 글꼴에 없는 글자(이모지)가 있어도 그려진다(빈 네모 대신 걸러냄).
  const nicknames = [Buffer.from("지훈🎂").toString("base64url"), Buffer.from("민수").toString("base64url")].join(".");
  await expectOgPng(page, `/s/og?${query}&n=${nicknames}`);

  // 링크가 깨졌거나 서버가 답하지 못해도 기본 미리보기 이미지를 준다.
  await expectOgPng(page, "/s/og?v=9");
  await expectOgPng(page, "/opengraph-image");
});
