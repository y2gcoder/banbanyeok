import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

// UPDATE_SCREENSHOTS=1 이면 docs/setup/p4-screens/에 모바일 화면을 저장한다(PR·노트용).
const shotsDir = resolve(import.meta.dirname, "../../docs/setup/p4-screens");
async function shot(page: Page, name: string) {
  if (!process.env.UPDATE_SCREENSHOTS) return;
  mkdirSync(shotsDir, { recursive: true });
  await page.screenshot({ path: resolve(shotsDir, `${name}.png`), fullPage: true });
}

async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

async function pickStation(page: Page, field: string, query: string, option: RegExp) {
  await page.getByRole("combobox", { name: field }).fill(query);
  await page.getByRole("option", { name: option }).click();
}

test("입력 → 결과 → 모드 바꾸기 → 링크 복사 → 받은 링크 열기", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);

  // 화면 1: 입력. 열리자마자 서버를 미리 깨운다.
  const warmUp = page.waitForRequest((req) => req.url().endsWith("/api/healthz"));
  await page.goto("/");
  await warmUp;
  await expect(page.getByRole("heading", { name: /덜 억울할까/ })).toBeVisible();
  await expectAccessible(page);
  await shot(page, "1-home");

  await page.getByRole("textbox", { name: "1번째 사람 이름(선택)" }).fill("민수");
  await pickStation(page, "민수의 출발역", "강남", /^강남\s?2호선/);
  await pickStation(page, "친구1의 출발역", "ㅎㄷㅇㄱ", /^홍대입구\s?2호선/);
  await page.getByRole("button", { name: "만날 역 찾기" }).click();

  // 화면 2: 결과
  await expect(page).toHaveURL(/\/result\?v=1&o=[0-9a-z]{3}\.[0-9a-z]{3}&m=f&n=/);
  const top = page.getByRole("article").first();
  await expect(top.getByText("1위")).toBeVisible();
  await expect(top.getByText(/^\d+분$|^\d+시간( \d+분)?$/).first()).toBeVisible();
  await expect(page.getByRole("tab", { name: "공평하게" })).toHaveAttribute("aria-selected", "true");
  await expectAccessible(page);
  await shot(page, "2-result");

  await page.getByRole("tab", { name: "빨리 만나기" }).click();
  await expect(page).toHaveURL(/m=q/);
  await expect(top.getByText(/합쳐/)).toBeVisible();

  await page.getByRole("tab", { name: /쪽으로/ }).click();
  await expect(page).toHaveURL(/m=p[01]/);
  await page.getByRole("button", { name: "민수" }).click();
  await expect(page).toHaveURL(/m=p0/);
  await expect(page.getByRole("tab", { name: "민수 쪽으로" })).toHaveAttribute("aria-selected", "true");
  await shot(page, "2b-result-favor");

  // 화면 3: 공유(링크 복사)
  await page.getByRole("button", { name: "링크 복사" }).click();
  await expect(page.getByRole("button", { name: "링크를 복사했어요" })).toBeVisible();
  const shared = await page.evaluate(() => navigator.clipboard.readText());
  expect(shared).toMatch(/\/s\?v=1&o=[0-9a-z]{3}\.[0-9a-z]{3}&m=p0&n=66-87IiY\.$/);

  // 화면 4: 받은 링크(새 기기처럼 새 페이지)
  const friend = await context.newPage();
  await friend.goto(shared);
  await expect(friend.getByRole("heading", { name: "민수가 고른 만날 역 후보" })).toBeVisible();
  await friend.getByRole("group", { name: "나는 누구?" }).getByRole("button", { name: "친구1" }).click();
  await expect(friend).toHaveURL(/me=1/);
  const card = friend.getByRole("article").first();
  await expect(card.getByText("친구1(나)")).toBeVisible();
  await expect(card.getByRole("link", { name: "내 길찾기" })).toHaveAttribute(
    "href",
    /^https:\/\/map\.kakao\.com\/link\/by\/traffic\//,
  );
  await expectAccessible(friend);
  await shot(friend, "4-received");
  await friend.getByRole("link", { name: "나도 다른 조합으로 찾아보기" }).click();
  await expect(friend).toHaveURL(/\/$/);
});

test("카톡으로 보내기: 공유 시트가 없으면 링크 대화상자를 연다", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { value: undefined });
  });
  await page.goto("/result?v=1&o=k3a.ryf&m=f");
  await page.getByRole("button", { name: "카톡으로 보내기" }).click();
  const dialog = page.getByRole("dialog", { name: "링크를 보내 주세요" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "링크" })).toHaveValue(/\/s\?v=1&o=k3a\.ryf&m=f$/);
  await shot(page, "3-share-fallback");
});

test("받은 링크가 깨졌으면 무엇이 틀렸는지 말하고 새로 찾기로 보낸다", async ({ page }) => {
  await page.goto("/s?v=1&o=03V.130&m=f");
  await expect(page.getByRole("heading", { name: "링크를 열 수 없어요" })).toBeVisible();
  await expect(page.getByText(/역 정보를 읽지 못했어요/)).toBeVisible();
});

test("극단 상황: 같은 역에서 출발하면 같은 동네 안내", async ({ page }) => {
  await page.goto("/result?v=1&o=k3a.k3a&m=f");
  await expect(page.getByRole("list", { name: "안내" })).toHaveText(/이미 같은 동네예요. 강남역에서 만나세요./);
});
