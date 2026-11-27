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
  await page.getByRole("tab", { name: "모두 입력" }).click();
  await pickStation(page, "나의 출발역", "강남", /^강남\s?2호선/);
  await pickStation(page, "친구1의 출발역", "ㅎㄷㅇㄱ", /^홍대입구\s?2호선/);
  await page.getByRole("button", { name: "만날 역 찾기" }).click();

  await expect(page).toHaveURL(
    /\/result\?v=2&o=[0-9a-z]{3}\.[0-9a-z]{3}&m=f&t=(?:weekday|saturday|holiday)-(?:morning|day|evening|night)$/,
  );
  const top = page.getByRole("article").first();
  // 시간 행은 서버 짧은 이름(shortLabel), 추천 이유 문장은 label("…에서 오는 분")이다.
  // 이름은 1위 요약의 시간 줄에 먼저 나오고, "자세히" 안의 시간 막대·막차 칸에도 나온다.
  const rows = top.getByRole("listitem");
  await expect(rows.getByText("강남", { exact: true }).first()).toBeVisible();
  await expect(rows.getByText("홍대입구", { exact: true }).first()).toBeVisible();
  await top.getByRole("button", { name: /자세히/ }).click();
  await expect(top.getByText(/에서 오는 분/).first()).toBeVisible();
  // 결과·문장에 시점 표현이 없다. 만든 사람 화면에는 (나)가 없다.
  // "나는"·"나가"는 낱말로 쓰인 것만 본다("열차가 떠나는 시각"은 시점 표현이 아니다).
  await expect(page.getByRole("main")).not.toContainText(/(?<![가-힣])나는 |(?<![가-힣])나가 |친구1|\(나\)/);
  await shot(page, "1-result-no-names");

  await page.getByRole("button", { name: "링크 복사" }).click();
  const shared = await page.evaluate(() => navigator.clipboard.readText());
  expect(shared).toMatch(
    /\/s\?v=2&o=[0-9a-z]{3}\.[0-9a-z]{3}&m=f&t=(?:weekday|saturday|holiday)-(?:morning|day|evening|night)$/,
  );

  const friend = await context.newPage();
  await friend.goto(shared);
  await expect(friend.getByRole("heading", { name: "친구가 보낸 만날 역 후보" })).toBeVisible();
  const card = friend.getByRole("article").first();
  await expect(card.getByText("(나)")).toHaveCount(0);
  await friend
    .getByRole("group", { name: "나는 누구?" })
    .getByRole("button", { name: "홍대입구", exact: true })
    .click();
  await expect(friend).toHaveURL(/me=1/);
  await expect(card.getByText("홍대입구(나)").first()).toBeVisible();
  await expect(card.getByText("강남(나)")).toHaveCount(0);
  await shot(friend, "2-received-pick-friend");

  // 다른 사람으로 바꾸면 (나)도 옮겨 간다(예전 버그: "나"가 다른 사람을 가리킴).
  await friend.getByRole("group", { name: "나는 누구?" }).getByRole("button", { name: "강남", exact: true }).click();
  await expect(card.getByText("강남(나)").first()).toBeVisible();
  await expect(card.getByText("홍대입구(나)")).toHaveCount(0);
});

test("집에 가는 막차: 직행 확정은 분 그대로, 갈아타는 길은 10분 단위로 내린 시각, 계산하지 않는 길은 이유만 보인다", async ({
  page,
}) => {
  // 광교(신분당선)·부천(1호선), 평일 밤. dev 산출물에서 1위 고속터미널, 3위 강남이다.
  await page.goto("/result?v=2&o=dzc.ry7&m=f&t=weekday-night");
  const top = page.getByRole("article").first();
  // 접힌 1위 요약에도 맨 위 줄과 같은 말이 있다(#122: 막차는 숨기지 않는다).
  await expect(top.getByText("공개된 시각 중 가장 이름: 부천 23:00 · 더 확인할 분 있음").first()).toBeVisible();
  await top.getByRole("button", { name: /자세히/ }).click();
  const lastTrain = top.getByRole("region", { name: "집에 가는 막차" });
  await expect(lastTrain.getByText("평일 시간표")).toBeVisible();
  // 부천: 갈아타는 여유 시각 23:06 → 23:00. 광교: 고속터미널에서는 대조한 직행이 없어 시각이 없다.
  // 공개한 사람 가운데 시각이 없는 사람(광교)이 있어, 맨 위 줄이 범위를 밝힌다.
  await expect(lastTrain.getByText("공개된 시각 중 가장 이름: 부천 23:00 · 더 확인할 분 있음")).toBeVisible();
  const rows = lastTrain.getByRole("listitem");
  await expect(rows.nth(0)).toContainText("광교이 경로는 막차 계산 전.");
  await expect(rows.nth(0)).not.toContainText(/\d\d:\d\d/);
  await expect(rows.nth(1)).toContainText("부천늦어도23:00출발");
  await expect(rows.nth(1).getByRole("link", { name: "부천, 지도 앱에서 막차 확인하기" })).toHaveAttribute(
    "href",
    /^https:\/\/map\.kakao\.com\/link\/by\/traffic\//,
  );
  // 평일은 일부 노선만 계산한 요일 종류다(9호선을 끈 동안): 줄의 종류와 상관없이 알린다. 기준일은 시간표를 모은 날이다.
  await expect(lastTrain.getByText("평일은 일부 노선만 막차 표시.")).toBeVisible();
  await expect(lastTrain.getByText(/^시간표 수집 기준 \d{4}년 \d{1,2}월 \d{1,2}일\. 공사·행사로/)).toBeVisible();
  await expect(lastTrain).not.toContainText("계산했어요");

  // 3위 강남: 광교행 신분당선은 운영사 표와 대조한 직행이다(평일 24:03).
  const gangnamRow = page
    .getByRole("region", { name: "다른 후보" })
    .locator(":scope > details")
    .filter({ has: page.locator(":scope > summary", { hasText: "강남" }) });
  await gangnamRow.locator(":scope > summary").click();
  const gangnam = gangnamRow.getByRole("region", { name: "강남역 집에 가는 막차" });
  await expect(gangnam.getByRole("listitem").nth(0)).toContainText("광교막차00:03다음 날· 광교행강남역 출발 시각");
  await shot(page, "3-last-trains");

  // 옛 링크(v=1)에는 칸이 없다.
  await page.goto("/result?v=1&o=dzc.ry7&m=f");
  await page
    .getByRole("article")
    .first()
    .getByRole("button", { name: /자세히/ })
    .click();
  await expect(page.getByRole("region", { name: "집에 가는 막차" })).toHaveCount(0);
});

test("폐기된 역 코드가 든 옛 공유 링크도 열린다(공덕 194 → nn9)", async ({ page }) => {
  await page.goto("/s?v=1&o=194.ve5&m=f");
  const top = page.getByRole("article").first();
  const rows = top.getByRole("listitem");
  await expect(rows.getByText("공덕", { exact: true })).toBeVisible();
  await expect(rows.getByText("홍대입구", { exact: true })).toBeVisible();
});

test("이름을 넣은 사람은 그 이름, 같은 역 둘은 번호", async ({ page }) => {
  // n = base64url("민수"), 두 번째 사람은 이름 없음. 세 번째도 홍대입구.
  await page.goto("/s?v=1&o=ryf.ryf.k3a&m=f&n=66-87IiY..");
  const top = page.getByRole("article").first();
  const rows = top.getByRole("listitem");
  await expect(rows.getByText("민수", { exact: true })).toBeVisible();
  // 이름 없는 홍대입구는 하나뿐이라 번호 없이 짧은 이름 "홍대입구"
  await expect(rows.getByText("홍대입구", { exact: true })).toBeVisible();
  await expect(rows.getByText("강남", { exact: true })).toBeVisible();
});
