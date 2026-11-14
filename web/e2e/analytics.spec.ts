import { expect, type Page, test } from "@playwright/test";

// 통계(PostHog) 키 없이 빌드한 앱(playwright.config.ts가 키를 비워 빌드한다)은 완전히 꺼져 있어야 한다:
// 입력 → 결과 → 모드 → 정했어요 → 공유 → 받은 링크 → SEO 페이지까지 써 보며 같은 출처 밖으로 나가는 요청이 0건인지,
// PostHog가 저장소에 아무것도 남기지 않는지 확인한다.

async function pickStation(page: Page, field: string, query: string, option: RegExp) {
  await page.getByRole("combobox", { name: field }).fill(query);
  await page.getByRole("option", { name: option }).click();
}

test("키가 없으면 어떤 화면에서도 외부 네트워크 요청이 0건이고 저장소에 흔적이 없다", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? "http://127.0.0.1").origin;
  const outside: string[] = [];
  const all: string[] = [];
  context.on("request", (request) => {
    all.push(request.url());
    if (!request.url().startsWith(`${origin}/`) && !request.url().startsWith("data:")) outside.push(request.url());
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);

  await page.goto("/");
  await page.getByRole("textbox", { name: "1번째 사람 이름(선택)" }).fill("민수");
  await pickStation(page, "민수의 출발역", "강남", /^강남\s?2호선/);
  await pickStation(page, "친구1의 출발역", "ㅎㄷㅇㄱ", /^홍대입구\s?2호선/);
  await page.getByRole("button", { name: "만날 역 찾기" }).click();
  await expect(page.getByRole("article").first().getByText("1위")).toBeVisible();

  await page.getByRole("tab", { name: "빨리 만나기" }).click();
  await expect(page).toHaveURL(/m=q/);
  await page.getByRole("button", { name: "이 역으로 정했어요" }).first().click();
  await expect(page.getByText("정했어요! 각자 길찾기로 이어가요")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "링크 복사" }).click();
  await expect(page.getByRole("button", { name: "링크를 복사했어요" })).toBeVisible();
  const shared = await page.evaluate(() => navigator.clipboard.readText());

  const friend = await context.newPage();
  await friend.goto(shared);
  await friend.getByRole("group", { name: "나는 누구?" }).getByRole("button", { name: "참가자 2" }).click();
  await expect(friend).toHaveURL(/me=1/);
  await friend
    .getByRole("link", { name: "이 역으로 정했어요" })
    .first()
    .evaluate((a) => {
      a.addEventListener("click", (event) => event.preventDefault()); // 카카오맵 새 창은 열지 않는다
    });
  await friend.getByRole("link", { name: "이 역으로 정했어요" }).first().click();

  await friend.goto("/meet");
  const pair = friend.locator('a[href^="/meet/"]').first();
  await pair.click();
  await friend.getByRole("link", { name: "다른 역으로 다시 찾기" }).click();
  await expect(friend).toHaveURL(/\/\?o=/);

  expect(outside, `같은 출처 밖으로 나간 요청: ${outside.join(", ")}`).toEqual([]);
  expect(all.some((url) => /posthog/i.test(url))).toBe(false);
  for (const target of [page, friend]) {
    const keys = await target.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)]);
    expect(keys.filter((key) => /^ph_|posthog|^bby\.analytics/i.test(key))).toEqual([]);
    expect(await target.evaluate(() => document.cookie)).not.toMatch(/ph_/);
  }
});

test("이 역으로 정했어요: 사람별 길찾기 링크로 이어진다", async ({ page }) => {
  await page.goto("/result?v=1&o=k3a.ryf&m=f");
  const top = page.getByRole("article").first();
  await expect(top.getByText("1위")).toBeVisible();
  await top.getByRole("button", { name: "이 역으로 정했어요" }).click();
  const routes = page.getByRole("link", { name: /→/ });
  await expect(routes).toHaveCount(2);
  await expect(routes.first()).toHaveAttribute("href", /^https:\/\/map\.kakao\.com\/link\/by\/traffic\//);
});
