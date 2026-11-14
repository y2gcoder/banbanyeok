import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";

// 실제 서버(Ktor + 산출물)에 붙은 웹. 표시 이름은 서버 label이다(contracts/data-format.md §8).
// UPDATE_SCREENSHOTS=1 이면 docs/setup/w2-screens/에 저장한다(PR·노트용).
const shotsDir = resolve(import.meta.dirname, "../../docs/setup/w2-screens");
async function shot(page: Page, name: string) {
  if (!process.env.UPDATE_SCREENSHOTS) return;
  mkdirSync(shotsDir, { recursive: true });
  await page.screenshot({ path: resolve(shotsDir, `${name}.png`), fullPage: true });
}

async function pickStation(page: Page, field: string, query: string, option: RegExp) {
  await page.getByRole("combobox", { name: field }).fill(query);
  await page.getByRole("option", { name: option }).click();
}

test("이름 없는 2인: 입력 → 결과(서버 label) → 링크 복사 → 받은 링크에서 친구 고르기", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  // 입력 화면이 수화된 뒤(서버 미리 깨우기 요청이 effect에서 나간다) 입력한다. next dev는 첫 수화가 느리다.
  const warmUp = page.waitForRequest((req) => req.url().endsWith("/api/healthz"));
  await page.goto("/");
  await warmUp;
  await pickStation(page, "나의 출발역", "강남", /^강남\s?2호선/);
  await pickStation(page, "친구1의 출발역", "ㅎㄷㅇㄱ", /^홍대입구\s?2호선/);
  await page.getByRole("button", { name: "만날 역 찾기" }).click();

  await expect(page).toHaveURL(/\/result\?v=1&o=[0-9a-z]{3}\.[0-9a-z]{3}&m=f$/);
  const top = page.getByRole("article").first();
  await expect(top.getByText("강남에서 오는 분", { exact: true })).toBeVisible();
  await expect(top.getByText("홍대입구에서 오는 분", { exact: true })).toBeVisible();
  // 결과·문장에 시점 표현이 없다. 만든 사람 화면에는 (나)가 없다.
  await expect(page.getByRole("main")).not.toContainText(/나는 |나가 |친구1|\(나\)/);
  await shot(page, "1-result-no-names");

  await page.getByRole("button", { name: "링크 복사" }).click();
  const shared = await page.evaluate(() => navigator.clipboard.readText());
  expect(shared).toMatch(/\/s\?v=1&o=[0-9a-z]{3}\.[0-9a-z]{3}&m=f$/);

  const friend = await context.newPage();
  await friend.goto(shared);
  await expect(friend.getByRole("heading", { name: "친구가 보낸 만날 역 후보" })).toBeVisible();
  const card = friend.getByRole("article").first();
  await expect(card.getByText("(나)")).toHaveCount(0);
  await friend.getByRole("group", { name: "나는 누구?" }).getByRole("button", { name: "홍대입구에서 오는 분" }).click();
  await expect(friend).toHaveURL(/me=1/);
  await expect(card.getByText("홍대입구에서 오는 분(나)")).toBeVisible();
  await expect(card.getByText("강남에서 오는 분(나)")).toHaveCount(0);
  await shot(friend, "2-received-pick-friend");

  // 다른 사람으로 바꾸면 (나)도 옮겨 간다(예전 버그: "나"가 다른 사람을 가리킴).
  await friend.getByRole("group", { name: "나는 누구?" }).getByRole("button", { name: "강남에서 오는 분" }).click();
  await expect(card.getByText("강남에서 오는 분(나)")).toBeVisible();
  await expect(card.getByText("홍대입구에서 오는 분(나)")).toHaveCount(0);
});

test("폐기된 역 코드가 든 옛 공유 링크도 열린다(공덕 194 → nn9)", async ({ page }) => {
  await page.goto("/s?v=1&o=194.ve5&m=f");
  const top = page.getByRole("article").first();
  await expect(top.getByText("공덕에서 오는 분", { exact: true })).toBeVisible();
  await expect(top.getByText("홍대입구에서 오는 분", { exact: true })).toBeVisible();
});

test("이름을 넣은 사람은 그 이름, 같은 역 둘은 번호", async ({ page }) => {
  // n = base64url("민수"), 두 번째 사람은 이름 없음. 세 번째도 홍대입구.
  await page.goto("/s?v=1&o=ryf.ryf.k3a&m=f&n=66-87IiY..");
  const top = page.getByRole("article").first();
  await expect(top.getByText("민수", { exact: true })).toBeVisible();
  await expect(top.getByText("홍대입구에서 오는 분", { exact: true })).toBeVisible();
  await expect(top.getByText("강남에서 오는 분", { exact: true })).toBeVisible();
});
