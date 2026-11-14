import { expect, test } from "@playwright/test";

/**
 * 앱 아이콘·홈 화면 추가(U1): 브라우저 탭 아이콘, iOS 홈 화면 아이콘, 웹 앱 매니페스트, 주소창·상태 표시줄 색.
 * 파일 크기·형식은 단위 테스트(src/lib/seo/app-manifest.test.ts), 여기서는 운영 빌드가 실제로 내주는지 본다.
 */
test("탭 아이콘·홈 화면 아이콘·매니페스트를 내주고 <head>에 연결한다", async ({ page, request }) => {
  await page.goto("/");
  const head = page.locator("head");
  const href = async (selector: string) => (await head.locator(selector).first().getAttribute("href")) ?? "";

  // 아이콘 링크: favicon.ico, icon.svg, apple-touch-icon(180)
  const favicon = await href('link[rel="icon"][type="image/x-icon"]');
  const svg = await href('link[rel="icon"][type="image/svg+xml"]');
  const apple = await href('link[rel="apple-touch-icon"]');
  expect(favicon).toMatch(/^\/favicon\.ico/);
  expect(svg).toMatch(/^\/icon\.svg/);
  expect(apple).toMatch(/^\/apple-icon\.png/);
  await expect(head.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("sizes", "180x180");

  for (const [path, type] of [
    ["/favicon.ico", /image\/(x-icon|vnd\.microsoft\.icon)/],
    [favicon, /image\/(x-icon|vnd\.microsoft\.icon)/],
    [svg, /image\/svg\+xml/],
    [apple, /image\/png/],
  ] as const) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
    expect(res.headers()["content-type"], path).toMatch(type);
  }

  // 매니페스트와 그 아이콘
  expect(await href('link[rel="manifest"]')).toBe("/manifest.webmanifest");
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.status()).toBe(200);
  const body = (await manifest.json()) as {
    name: string;
    short_name: string;
    start_url: string;
    display: string;
    theme_color: string;
    background_color: string;
    icons: { src: string; sizes: string; purpose: string }[];
  };
  expect(body).toMatchObject({
    name: "반반역",
    short_name: "반반역",
    start_url: "/",
    display: "standalone",
    theme_color: "#eef1f0",
    background_color: "#eef1f0",
  });
  expect(body.icons.filter((i) => i.purpose === "maskable").map((i) => i.sizes)).toEqual(["192x192", "512x512"]);
  for (const icon of body.icons) {
    const res = await request.get(icon.src);
    expect(res.status(), icon.src).toBe(200);
    expect(res.headers()["content-type"], icon.src).toBe("image/png");
  }

  // 주소창·상태 표시줄: 화면이 밝은 모드 하나라 테마 색도 하나(승강장 회색). iOS 홈 화면 앱은 기본 상태 표시줄.
  await expect(head.locator('meta[name="theme-color"]')).toHaveCount(1);
  await expect(head.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#eef1f0");
  await expect(head.locator('meta[name="color-scheme"]')).toHaveAttribute("content", "light");
  await expect(head.locator('meta[name="apple-mobile-web-app-status-bar-style"]')).toHaveAttribute(
    "content",
    "default",
  );
  await expect(head.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute("content", "반반역");
});

test.describe("어두운 모드 기기", () => {
  test.use({ colorScheme: "dark" });

  test("기기가 어두운 모드여도 화면과 테마 색은 밝은 승강장 회색 그대로다", async ({ page }) => {
    await page.goto("/");
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe("rgb(238, 241, 240)");
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#eef1f0");
  });
});
