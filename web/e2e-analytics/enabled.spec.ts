import { gunzipSync } from "node:zlib";
import { expect, type Page, test } from "@playwright/test";

// 통계를 켠 빌드에서 실제로 무엇이 나가는지: 요청은 PostHog 수집 주소(`/e/`)뿐이고, 이벤트는 계약의 것만이며,
// 출발역(코드·이름)·사람 이름·공유 링크 쿼리가 속성 어디에도 없다. PostHog는 자동화 브라우저를 봇으로 보고 이벤트를 버리므로
// 봇 신호만 이 테스트 안에서 끈다(앱 코드에는 영향 없음).

const COLLECT = "https://eu.i.posthog.com/e/";
const FORBIDDEN_KEY = /origin|nickname|room_id|token_|alias|^lat$|^lng$|address/i;

type Captured = { event: string; properties: Record<string, unknown> };

async function pickStation(page: Page, field: string, query: string, option: RegExp) {
  await page.getByRole("combobox", { name: field }).fill(query);
  await page.getByRole("option", { name: option }).click();
}

test("켜진 통계: 계약의 이벤트만, 출발역·이름·쿼리 없이 수집 주소로만 나간다", async ({ page, context }) => {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    Object.defineProperty(navigator, "userAgentData", { get: () => undefined });
  });
  const outside: string[] = [];
  const events: Captured[] = [];
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (route) => {
    const request = route.request();
    outside.push(`${request.method()} ${request.url().split("?")[0]}`);
    const body = request.postDataBuffer();
    if (body && request.url().startsWith(COLLECT)) {
      let text: string;
      try {
        text = gunzipSync(body).toString("utf8");
      } catch {
        text = body.toString("utf8");
      }
      const parsed = JSON.parse(text) as Captured | Captured[] | { batch: Captured[] };
      events.push(...("batch" in parsed ? parsed.batch : Array.isArray(parsed) ? parsed : [parsed]));
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.goto("/");
  await page.getByRole("textbox", { name: "1번째 사람 이름(선택)" }).fill("민수");
  await pickStation(page, "민수의 출발역", "강남", /^강남\s?2호선/);
  await pickStation(page, "친구1의 출발역", "ㅎㄷㅇㄱ", /^홍대입구\s?2호선/);
  await page.getByRole("button", { name: "만날 역 찾기" }).click();
  await expect(page).toHaveURL(/\/result\?v=1&o=[0-9a-z]{3}\.[0-9a-z]{3}/);
  const originCodes = new URL(page.url()).searchParams.get("o")?.split(".") ?? [];
  expect(originCodes).toHaveLength(2);
  await expect(page.getByRole("article").first().getByText("1위")).toBeVisible();
  await page.getByRole("tab", { name: "빨리 만나기" }).click();
  await expect(page).toHaveURL(/m=q/);
  await page.getByRole("button", { name: "이 역으로 정했어요" }).first().click();
  await expect(page.getByText("정했어요! 각자 길찾기로 이어가요")).toBeVisible();
  await page.waitForTimeout(3500); // 배치 전송(약 3초) 대기

  const friend = await context.newPage();
  await friend.goto(page.url().replace("/result", "/s"));
  await friend.getByRole("group", { name: "나는 누구?" }).getByRole("button").nth(1).click();
  await friend.waitForTimeout(3500);
  await friend.goto("/meet");
  await friend.locator('a[href^="/meet/"]').first().click();
  await friend.getByRole("link", { name: "다른 역으로 다시 찾기" }).click();
  await friend.waitForTimeout(3500);

  // 나간 요청은 수집 주소 하나뿐(/flags·원격 설정·녹화·설문 스크립트 없음).
  expect([...new Set(outside)]).toEqual([`POST ${COLLECT}`]);

  expect(new Set(events.map((e) => e.event))).toEqual(
    new Set([
      "input_completed",
      "result_viewed",
      "mode_switched",
      "station_chosen",
      "link_opened",
      "link_person_selected",
      "seo_to_input_clicked",
    ]),
  ); // $pageview·$autocapture 등 자동 이벤트 없음

  for (const { event, properties } of events) {
    const where = `${event}`;
    expect(
      Object.keys(properties).filter((key) => FORBIDDEN_KEY.test(key)),
      where,
    ).toEqual([]);
    expect(properties.platform, where).toBe("web");
    expect(properties.$process_person_profile, where).toBe(false); // 익명
    expect(properties.$geoip_disable, where).toBe(true);
    expect(properties, where).not.toHaveProperty("$raw_user_agent");
    // URL류 속성에는 쿼리가 없다.
    for (const [key, value] of Object.entries(properties)) {
      if (/url|referrer/i.test(key) && typeof value === "string") expect(value, `${where}.${key}`).not.toMatch(/[?#]/);
    }
    // 장소(만날 역) 필드를 뺀 나머지에 출발역 코드·이름·사람 이름·쿼리 흔적이 없다.
    const { meeting_station_code: _meeting, top1_station_code: _top, ...rest } = properties;
    const text = JSON.stringify(rest);
    for (const needle of [...originCodes, "강남", "홍대", "민수", "o=", "66-87"]) {
      expect(text, `${where} 속성에 "${needle}"`).not.toContain(needle);
    }
  }

  // 응답 시간 구간·인원 같은 파생 값은 들어 있다.
  const viewed = events.filter((e) => e.event === "result_viewed");
  expect(viewed.length).toBeGreaterThanOrEqual(2);
  expect(viewed[0]?.properties).toMatchObject({
    participant_count: 2,
    candidate_count: 3,
    response_time_bucket: "0-300",
  });
  expect(events.find((e) => e.event === "station_chosen")?.properties).toMatchObject({
    rank: 1,
    link_variant: "creator",
  });
});
