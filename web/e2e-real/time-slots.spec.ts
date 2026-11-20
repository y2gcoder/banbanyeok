import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";

/**
 * "언제 만나요?"(T2) 실제 서버 e2e: 같은 출발역이라도 요일·시간대 구분마다 결과가 달라지고, 화면이 계산 기준을 알린다.
 * 옛 공유 링크(v=1)는 계속 평일 낮이다. UPDATE_SCREENSHOTS=1 이면 docs/setup/t2-screens/에 저장한다.
 */
const shotsDir = resolve(import.meta.dirname, "../../docs/setup/t2-screens");
async function shot(page: Page, name: string) {
  if (!process.env.UPDATE_SCREENSHOTS) return;
  mkdirSync(shotsDir, { recursive: true });
  await page.screenshot({ path: resolve(shotsDir, `${name}.png`), fullPage: true });
}

/** 혜화 + 강남: dev 산출물에서 평일 낮 1위는 압구정, 토요일 밤 1위는 약수다(data/config/time-slot-report.json). */
const HYEHWA = "2je";
const GANGNAM = "k3a";
const ORIGINS = `${HYEHWA}.${GANGNAM}`;

// next dev는 화면마다 처음 컴파일이 느리다.
test.setTimeout(120_000);

async function topCard(page: Page) {
  const top = page.getByRole("article").first();
  await expect(top.getByText("1위")).toBeVisible();
  return top;
}

test("같은 출발역이라도 평일 낮과 토요일 밤의 순위·시간이 다르다", async ({ page }) => {
  await page.goto(`/result?v=2&o=${ORIGINS}&m=f&t=weekday-day`);
  const day = await topCard(page);
  await expect(page.getByText("역에서 역까지, 평일 낮 기준 시간이에요.")).toBeVisible();
  await expect(day.getByRole("heading", { level: 2 })).toContainText("압구정");
  const dayText = await day.textContent();
  await shot(page, "1-weekday-day");

  await page.goto(`/result?v=2&o=${ORIGINS}&m=f&t=saturday-night`);
  const night = await topCard(page);
  await expect(page.getByText("역에서 역까지, 토요일 밤 기준 시간이에요.")).toBeVisible();
  await expect(night.getByRole("heading", { level: 2 })).toContainText("약수");
  expect(await night.textContent()).not.toBe(dayText);
  await shot(page, "2-saturday-night");
});

/** 카드의 글에서 "집에 가는 막차" 칸을 뺀 것. 옛 링크(v=1)에는 그 칸이 없다(요일을 고른 적이 없어서). */
async function textWithoutLastTrain(page: Page): Promise<string> {
  return (await topCard(page)).evaluate((card) => {
    const copy = card.cloneNode(true) as HTMLElement;
    for (const section of copy.querySelectorAll("section")) {
      // 제목 앞에 화면에는 안 보이는 역 이름이 붙는다("양재역 집에 가는 막차").
      if (section.querySelector("h3")?.textContent?.endsWith("집에 가는 막차")) section.remove();
    }
    return copy.textContent ?? "";
  });
}

test("옛 공유 링크(v=1)는 평일 낮으로 계산해 v=2 평일 낮과 같은 결과다(막차 칸만 없다)", async ({ page }) => {
  await page.goto(`/s?v=1&o=${ORIGINS}&m=f`);
  const legacy = await topCard(page);
  await expect(page.getByText("역에서 역까지, 평일 낮 기준 시간이에요.")).toBeVisible();
  await expect(legacy.getByRole("region", { name: "집에 가는 막차" })).toHaveCount(0);
  const legacyText = await legacy.textContent();
  await page.goto(`/s?v=2&o=${ORIGINS}&m=f&t=weekday-day`);
  await expect((await topCard(page)).getByRole("region", { name: "집에 가는 막차" })).toBeVisible();
  expect(await textWithoutLastTrain(page)).toBe(legacyText);
});

test("입력 화면에서 고른 요일·시간대가 결과·공유 링크에 담긴다", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const warmUp = page.waitForRequest((req) => req.url().endsWith("/api/healthz"), { timeout: 90_000 });
  await page.goto("/");
  await warmUp;
  const when = page.getByRole("group", { name: "언제 만나요?" });
  await expect(when.getByRole("radio", { checked: true })).toHaveCount(2); // 기본값(지금 시각)이 처음부터 골라져 있다
  await page.getByRole("combobox", { name: "나의 출발역" }).fill("혜화");
  await page.getByRole("option", { name: /^혜화\s?4호선/ }).click();
  await page.getByRole("combobox", { name: "친구1의 출발역" }).fill("강남");
  await page.getByRole("option", { name: /^강남\s?2호선/ }).click();
  await when.getByRole("radio", { name: "일요일·공휴일" }).click();
  await when.getByRole("radio", { name: /^아침/ }).click();
  await shot(page, "0-home-when");
  await page.getByRole("button", { name: "만날 역 찾기" }).click();
  await expect(page).toHaveURL(/&t=holiday-morning$/);
  await topCard(page);
  await expect(page.getByText("역에서 역까지, 일요일·공휴일 아침 기준 시간이에요.")).toBeVisible();
  await page.getByRole("button", { name: "링크 복사" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(
    /\/s\?v=2&o=2je\.k3a&m=f&t=holiday-morning$/,
  );
});

test("방은 약속 날짜·시각으로 구분을 정한다(토요일 22:00 → 토요일 밤)", async ({
  page,
  request,
  browser,
}, testInfo) => {
  const saturday = upcomingSaturday();

  const warmUp = page.waitForRequest((req) => req.url().endsWith("/api/healthz"));
  await page.goto("/r/new");
  await warmUp; // 수화가 끝나야 역 검색이 움직인다.
  await page.getByRole("combobox", { name: "내 출발역" }).fill("혜화");
  await page.getByRole("option", { name: /^혜화\s?4호선/ }).click();
  await page.getByRole("radio", { name: /이번 토요일/ }).check();
  await page.getByRole("button", { name: "+ 정확한 시각 넣기" }).click();
  await page.getByLabel("시각", { exact: true }).fill("22:00");
  await expect(page.getByText("토요일 밤 기준으로 계산해요")).toBeVisible();
  await shot(page, "3-room-create-when");
  await page.getByRole("button", { name: "방 만들기" }).click();
  await expect(page).toHaveURL(/\/r\/[0-9a-hjkmnp-tv-z]{10}$/);
  const roomId = new URL(page.url()).pathname.split("/").pop() ?? "";
  const joined = await request.post(`/api/v1/rooms/${roomId}/participants`, { data: { originCode: GANGNAM } });
  expect(joined.status()).toBe(201);

  const room = await (await request.get(`/api/v1/rooms/${roomId}`)).json();
  expect(room.meetingDate).toBe(saturday);
  expect(room.meetingTime).toBe("22:00");
  // 서버가 방 응답에 계산 기준(label)을 준다. 결과가 생기기 전에도.
  expect(room.timeBasis).toMatchObject({ timeSlot: "saturday-night", label: "토요일 밤", holidayName: null });
  const result = await (await request.get(`/api/v1/rooms/${roomId}/result`)).json();
  expect(result.timeBasis).toMatchObject({ timeSlot: "saturday-night", label: "토요일 밤" });

  // 링크로 들어온 친구(참여 전)의 화면에도 방장 화면과 같은 기준 문구가 서버 label로 나온다.
  const guest = await browser.newContext({
    ...(testInfo.project.use.baseURL ? { baseURL: testInfo.project.use.baseURL } : {}),
    locale: "ko-KR",
  });
  try {
    const guestPage = await guest.newPage();
    await guestPage.goto(`/r/${roomId}`);
    await expect(guestPage.getByRole("form", { name: "나도 출발역 넣기" })).toBeVisible();
    await expect(guestPage.getByText("토요일 밤 기준으로 계산해요")).toBeVisible();
  } finally {
    await guest.close();
  }

  await page.reload();
  await expect(page.getByText("역에서 역까지, 토요일 밤 기준 시간이에요.")).toBeVisible();
  await expect(page.getByText(/약속 \d+월 \d+일 \(토\) 22:00/)).toBeVisible();
  await shot(page, "4-room-result-when");
});

test("시간대만 고른 방은 시각 없이 시간대로 구분을 정한다(이번 토요일 저녁 → 토요일 저녁)", async ({
  page,
  request,
}) => {
  const saturday = upcomingSaturday();
  const warmUp = page.waitForRequest((req) => req.url().endsWith("/api/healthz"));
  await page.goto("/r/new");
  await warmUp;
  await page.getByRole("combobox", { name: "내 출발역" }).fill("혜화");
  await page.getByRole("option", { name: /^혜화\s?4호선/ }).click();
  await page.getByRole("radio", { name: /이번 토요일/ }).check();
  await page.getByRole("radio", { name: /저녁/ }).check();
  await expect(page.getByText("토요일 저녁 기준으로 계산해요")).toBeVisible();
  const created = page.waitForRequest((req) => req.url().endsWith("/api/v1/rooms") && req.method() === "POST");
  await page.getByRole("button", { name: "방 만들기" }).click();
  const body = (await created).postDataJSON();
  expect(body).toMatchObject({ meetingDate: saturday, meetingBand: "evening" });
  expect(body).not.toHaveProperty("meetingTime");
  await expect(page).toHaveURL(/\/r\/[0-9a-hjkmnp-tv-z]{10}$/);
  const roomId = new URL(page.url()).pathname.split("/").pop() ?? "";

  const room = await (await request.get(`/api/v1/rooms/${roomId}`)).json();
  expect(room.meetingDate).toBe(saturday);
  expect(room.meetingTime).toBeNull();
  expect(room.meetingBand).toBe("evening");
  expect(room.timeBasis).toMatchObject({ timeSlot: "saturday-evening", label: "토요일 저녁" });
  await expect(page.getByText(/약속 \d+월 \d+일 \(토\) 저녁/)).toBeVisible();
});

/** "이번 토요일"(서울 기준, 오늘이 토요일이면 오늘). 화면의 칩과 같은 규칙이다. */
function upcomingSaturday(): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + ((6 - date.getUTCDay() + 7) % 7));
  return date.toISOString().slice(0, 10);
}
