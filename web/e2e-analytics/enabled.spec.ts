import { gunzipSync } from "node:zlib";
import AxeBuilder from "@axe-core/playwright";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";

// 통계 키를 박아 빌드한 앱(playwright.analytics.config.ts)에서의 동의(옵트인)와 실제 전송 내용.
// 동의 전·거부·철회 뒤에는 PostHog로 가는 요청이 0건이고, 동의한 뒤에는 수집 주소(`/e/`) 하나로만, 계약의 이벤트만, 출발역·이름·쿼리
// 없이 나간다. 요청은 브라우저에서 가로채 실제 PostHog에는 닿지 않는다. PostHog는 자동화 브라우저를 봇으로 보고 이벤트를 버리므로
// 봇 신호만 이 테스트 안에서 끈다(앱 코드에는 영향 없음).

const COLLECT = "https://eu.i.posthog.com/e/";
const FORBIDDEN_KEY = /origin|nickname|room_id|token_|alias|^lat$|^lng$|address/i;
const BATCH_WAIT_MS = 4000; // posthog-js 배치 전송 주기(약 3초)보다 길게

type Captured = { event: string; properties: Record<string, unknown> };

type Probe = {
  /** 같은 출처 밖으로 나간 모든 요청("메서드 주소"). */
  outside: string[];
  events: Captured[];
  allUrls: string[];
};

async function attachProbe(context: BrowserContext, baseURL: string): Promise<Probe> {
  const probe: Probe = { outside: [], events: [], allUrls: [] };
  const origin = new URL(baseURL).origin;
  context.on("request", (request) => probe.allUrls.push(request.url()));
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (route) => {
    const request = route.request();
    probe.outside.push(`${request.method()} ${request.url().split("?")[0]}`);
    const body = request.postDataBuffer();
    if (body && request.url().startsWith(COLLECT)) {
      let text: string;
      try {
        text = gunzipSync(body).toString("utf8");
      } catch {
        text = body.toString("utf8");
      }
      const parsed = JSON.parse(text) as Captured | Captured[] | { batch: Captured[] };
      probe.events.push(...("batch" in parsed ? parsed.batch : Array.isArray(parsed) ? parsed : [parsed]));
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  expect(origin).toMatch(/^http:\/\/127\.0\.0\.1/);
  return probe;
}

async function disableBotSignals(context: BrowserContext) {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    Object.defineProperty(navigator, "userAgentData", { get: () => undefined });
  });
}

const banner = (page: Page) => page.getByRole("region", { name: /이용 통계를 모아도 될까요/ });

async function pickStation(page: Page, field: string, query: string, option: RegExp) {
  await page.getByRole("combobox", { name: field }).fill(query);
  await page.getByRole("option", { name: option }).click();
}

/** 입력 → 결과 → 모드 → 정했어요를 쓴다(배너가 떠 있어도 막히지 않아야 한다). */
async function useApp(page: Page) {
  await page.goto("/");
  await page.getByRole("textbox", { name: "1번째 사람 이름(선택)" }).fill("민수");
  await pickStation(page, "민수의 출발역", "강남", /^강남\s?2호선/);
  await pickStation(page, "친구1의 출발역", "ㅎㄷㅇㄱ", /^홍대입구\s?2호선/);
  await page.getByRole("button", { name: "만날 역 찾기" }).click();
  await expect(page).toHaveURL(/\/result\?v=1&o=[0-9a-z]{3}\.[0-9a-z]{3}/);
  await expect(page.getByRole("article").first().getByText("1위")).toBeVisible();
  await page.getByRole("tab", { name: "빨리 만나기" }).click();
  await expect(page).toHaveURL(/m=q/);
  await page.getByRole("button", { name: "이 역으로 정했어요" }).first().click();
  await expect(page.getByText("정했어요! 각자 길찾기로 이어가요")).toBeVisible();
  await page.keyboard.press("Escape");
}

const storageKeys = (page: Page) => page.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)]);
const analyticsKeys = async (page: Page) =>
  (await storageKeys(page)).filter((key) => /^ph_|^__ph_|^bby\.analytics\.seen$/i.test(key));

test.beforeEach(async ({ context, baseURL }, testInfo) => {
  await disableBotSignals(context);
  testInfo.annotations.push({ type: "base", description: baseURL ?? "" });
});

test("동의 전(아무것도 누르지 않음): 배너만 뜨고 요청 0건·저장소 흔적 없음, 배너가 흐름을 막지 않는다", async ({
  page,
  context,
  baseURL,
}) => {
  const probe = await attachProbe(context, baseURL ?? "");
  await page.goto("/");
  await expect(banner(page)).toBeVisible();
  await useApp(page); // 배너를 건드리지 않고 핵심 흐름을 끝까지 쓴다
  await expect(banner(page)).toBeVisible(); // 선택하지 않으면 계속 미동의
  await page.goto("/meet");
  await page.locator('a[href^="/meet/"]').first().click();
  await page.waitForTimeout(BATCH_WAIT_MS);

  expect(probe.outside).toEqual([]);
  expect(probe.allUrls.some((url) => /posthog/i.test(url))).toBe(false);
  expect(await analyticsKeys(page)).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem("bby.analytics.consent"))).toBeNull();
});

test("거부: 배너가 사라지고 요청 0건, 새로 고쳐도 다시 묻지 않는다", async ({ page, context, baseURL }) => {
  const probe = await attachProbe(context, baseURL ?? "");
  await page.goto("/");
  await banner(page).getByRole("button", { name: "거부" }).click();
  await expect(banner(page)).toHaveCount(0);
  await useApp(page);
  await page.reload();
  await expect(page.getByRole("article").first().getByText("1위")).toBeVisible();
  await expect(banner(page)).toHaveCount(0);
  await page.waitForTimeout(BATCH_WAIT_MS);

  expect(probe.outside).toEqual([]);
  expect(await analyticsKeys(page)).toEqual([]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("bby.analytics.consent") ?? "{}"))).toMatchObject({
    v: 1,
    status: "denied",
  });
});

test("동의: 그때부터 수집 주소로만, 계약의 이벤트만, 출발역·이름·쿼리 없이 나간다", async ({
  page,
  context,
  baseURL,
}) => {
  const probe = await attachProbe(context, baseURL ?? "");
  await page.goto("/");
  expect(probe.outside).toEqual([]); // 배너가 떠 있는 동안
  await banner(page).getByRole("button", { name: "동의" }).click();
  await expect(banner(page)).toHaveCount(0);
  // 동의 이벤트가 나간 뒤에 페이지를 옮긴다(전체 새로 불러오기 직전의 마지막 이벤트는 배치 전송이 못 나갈 수 있다).
  await expect.poll(() => probe.events.map((e) => e.event), { timeout: 15_000 }).toContain("analytics_consent_changed");
  await useApp(page);
  await expect(page).toHaveURL(/\/result\?/);
  const originCodes = new URL(page.url()).searchParams.get("o")?.split(".") ?? [];
  expect(originCodes).toHaveLength(2);
  await page.waitForTimeout(BATCH_WAIT_MS);

  const friend = await context.newPage();
  await friend.goto(page.url().replace("/result", "/s"));
  await expect(banner(friend)).toHaveCount(0); // 같은 기기: 이미 동의함
  await friend.getByRole("group", { name: "나는 누구?" }).getByRole("button").nth(1).click();
  await friend.waitForTimeout(BATCH_WAIT_MS);
  await friend.goto("/meet");
  await friend.locator('a[href^="/meet/"]').first().click();
  await friend.getByRole("link", { name: "다른 역으로 다시 찾기" }).click();
  await friend.waitForTimeout(BATCH_WAIT_MS);

  // 나간 요청은 수집 주소 하나뿐(/flags·원격 설정·녹화·설문 스크립트 없음).
  expect([...new Set(probe.outside)]).toEqual([`POST ${COLLECT}`]);
  expect(new Set(probe.events.map((e) => e.event))).toEqual(
    new Set([
      "analytics_consent_changed",
      "input_completed",
      "result_viewed",
      "mode_switched",
      "station_chosen",
      "link_opened",
      "link_person_selected",
      "seo_to_input_clicked",
    ]),
  ); // $pageview·$autocapture 등 자동 이벤트 없음
  expect(probe.events[0]?.event).toBe("analytics_consent_changed"); // 동의한 순간이 첫 이벤트다(그 전 이벤트는 없다)

  for (const { event, properties } of probe.events) {
    expect(
      Object.keys(properties).filter((key) => FORBIDDEN_KEY.test(key)),
      event,
    ).toEqual([]);
    expect(properties.platform, event).toBe("web");
    expect(properties.$process_person_profile, event).toBe(false); // 익명
    expect(properties.$geoip_disable, event).toBe(true);
    expect(properties, event).not.toHaveProperty("$raw_user_agent");
    for (const [key, value] of Object.entries(properties)) {
      if (/url|referrer/i.test(key) && typeof value === "string") expect(value, `${event}.${key}`).not.toMatch(/[?#]/);
    }
    const { meeting_station_code: _meeting, top1_station_code: _top, ...rest } = properties;
    const text = JSON.stringify(rest);
    for (const needle of [...originCodes, "강남", "홍대", "민수", "o=", "66-87"]) {
      expect(text, `${event} 속성에 "${needle}"`).not.toContain(needle);
    }
  }
  const viewed = probe.events.filter((e) => e.event === "result_viewed");
  expect(viewed.length).toBeGreaterThanOrEqual(2);
  expect(viewed[0]?.properties).toMatchObject({
    participant_count: 2,
    candidate_count: 3,
    response_time_bucket: "0-300",
  });
  expect(probe.events.find((e) => e.event === "station_chosen")?.properties).toMatchObject({
    rank: 1,
    link_variant: "creator",
  });
  expect(probe.events.find((e) => e.event === "analytics_consent_changed")?.properties).toMatchObject({
    granted: true,
  });
});

test("철회: /privacy에서 끄면 바로 멈추고 저장된 식별자를 지운다, 다시 켜면 그때부터 다시 보낸다", async ({
  page,
  context,
  baseURL,
}) => {
  const probe = await attachProbe(context, baseURL ?? "");
  await page.goto("/");
  await banner(page).getByRole("button", { name: "동의" }).click();
  await expect.poll(() => probe.events.length, { timeout: 15_000 }).toBeGreaterThan(0);
  expect(await analyticsKeys(page)).not.toEqual([]); // 동의한 뒤에는 식별자가 있다

  // 하단 "통계 설정" 링크로 간다(클라이언트 이동이 아니므로 새로 불러온다).
  await page.getByRole("link", { name: "통계 설정" }).click();
  await expect(page).toHaveURL(/\/privacy#analytics-settings$/);
  const toggle = page.getByRole("switch", { name: "이용 통계 수집 동의" });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("동의함 — 이용 통계를 모으고 있어요.")).toBeVisible();

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(page.getByText("동의하지 않음")).toBeVisible();
  expect(await analyticsKeys(page)).toEqual([]); // 즉시 지워진다(옵트아웃 표시 __ph_opt_in_out_*는 식별자가 아니라 둔다)
  const settled = probe.outside.length;

  await useApp(page); // 철회 뒤에 앱을 써도
  await page.waitForTimeout(BATCH_WAIT_MS);
  expect(probe.outside.length).toBe(settled); // 새 요청 0건
  expect(await analyticsKeys(page)).toEqual([]);

  await page.reload();
  await page.waitForTimeout(BATCH_WAIT_MS);
  expect(probe.outside.length).toBe(settled);
  await expect(banner(page)).toHaveCount(0); // 철회는 거부로 기억되어 다시 묻지 않는다

  // 다시 동의하면 그때부터 다시 보낸다.
  await page.goto("/privacy");
  await page.getByRole("switch", { name: "이용 통계 수집 동의" }).click();
  await expect.poll(() => probe.outside.length, { timeout: 15_000 }).toBeGreaterThan(settled);
  expect(probe.events.at(-1)?.event).toBe("analytics_consent_changed");
});

test("다른 탭에서 철회해도 이 탭의 수집이 멈춘다", async ({ page, context, baseURL }) => {
  const probe = await attachProbe(context, baseURL ?? "");
  await page.goto("/");
  await banner(page).getByRole("button", { name: "동의" }).click();
  await expect.poll(() => probe.events.length, { timeout: 15_000 }).toBeGreaterThan(0);

  const other = await context.newPage();
  await other.goto("/privacy");
  await other.getByRole("switch", { name: "이용 통계 수집 동의" }).click();
  await expect.poll(() => analyticsKeys(page)).toEqual([]); // storage 이벤트로 이 탭도 지운다
  const settled = probe.outside.length;
  await page.getByRole("textbox", { name: "1번째 사람 이름(선택)" }).fill("민수");
  await pickStation(page, "민수의 출발역", "강남", /^강남\s?2호선/);
  await pickStation(page, "친구1의 출발역", "ㅎㄷㅇㄱ", /^홍대입구\s?2호선/);
  await page.getByRole("button", { name: "만날 역 찾기" }).click();
  await expect(page.getByRole("article").first()).toBeVisible();
  await page.waitForTimeout(BATCH_WAIT_MS);
  expect(probe.outside.length).toBe(settled);
});

for (const signal of ["doNotTrack", "globalPrivacyControl"] as const) {
  test(`${signal}가 켜져 있으면 묻지 않고, 이미 동의했어도 수집하지 않는다`, async ({ page, context, baseURL }) => {
    await context.addInitScript((name) => {
      Object.defineProperty(navigator, name, { get: () => (name === "doNotTrack" ? "1" : true) });
      localStorage.setItem(
        "bby.analytics.consent",
        JSON.stringify({ v: 1, status: "granted", at: "2026-11-14T00:00:00Z" }),
      );
    }, signal);
    const probe = await attachProbe(context, baseURL ?? "");
    await useApp(page);
    await expect(banner(page)).toHaveCount(0);
    await page.waitForTimeout(BATCH_WAIT_MS);
    expect(probe.outside).toEqual([]);
    expect(await analyticsKeys(page)).toEqual([]);

    await page.goto("/privacy");
    await expect(page.getByText(/추적 거부 신호/).first()).toBeVisible();
    await expect(page.getByRole("switch", { name: "이용 통계 수집 동의" })).toBeDisabled();
  });
}

test("배너 접근성: axe 위반 0, 키보드로 고를 수 있고 모바일에서 작다", async ({ page }) => {
  await page.goto("/");
  const region = banner(page);
  await expect(region).toBeVisible();
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);

  const box = await region.boundingBox();
  const viewport = page.viewportSize();
  expect(box && viewport && box.height < viewport.height * 0.3).toBe(true);
  expect(box && viewport && box.y + box.height <= viewport.height + 1).toBe(true); // 화면 아래에 붙어 있다

  // 거부·동의 버튼 크기가 같다(같은 무게).
  const reject = await region.getByRole("button", { name: "거부" }).boundingBox();
  const accept = await region.getByRole("button", { name: "동의" }).boundingBox();
  expect(reject?.width).toBeCloseTo(accept?.width ?? -1, 0);
  expect(reject?.height).toBeCloseTo(accept?.height ?? -1, 0);

  // 키보드: 버튼에 초점을 두고 Enter로 선택한다.
  await region.getByRole("button", { name: "거부" }).focus();
  await page.keyboard.press("Tab");
  await expect(region.getByRole("button", { name: "동의" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(banner(page)).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("bby.analytics.consent") ?? "{}").status)).toBe(
    "granted",
  );
});

test("/privacy의 통계 설정: axe 위반 0", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { level: 2, name: "통계 설정" })).toBeVisible();
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
});

test("삭제 요청용 식별자: /privacy에 이 브라우저의 식별자를 보이고 복사할 수 있으며, 철회해도 화면에 남고, 어디로도 보내지 않는다", async ({
  page,
  context,
  baseURL,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const probe = await attachProbe(context, baseURL ?? "");
  await page.goto("/");
  await banner(page).getByRole("button", { name: "동의" }).click();
  await expect.poll(() => probe.events.length, { timeout: 15_000 }).toBeGreaterThan(0);
  const sentId = probe.events[0]?.properties.distinct_id;
  expect(typeof sentId).toBe("string");

  await page.getByRole("link", { name: "통계 설정" }).click();
  const box = page.getByRole("textbox", { name: "이 브라우저의 통계 식별자" });
  await expect(box).toHaveValue(String(sentId));
  await page.getByRole("button", { name: "복사", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(sentId);
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);

  const requestsBefore = probe.allUrls.length;
  await page.getByRole("switch", { name: "이용 통계 수집 동의" }).click();
  const cleared = page.getByRole("textbox", { name: "방금 지운 통계 식별자" });
  await expect(cleared).toHaveValue(String(sentId)); // 삭제 요청에 쓰도록 이 화면에는 남는다
  expect(await analyticsKeys(page)).toEqual([]); // 기기에서는 지워졌다
  await page.waitForTimeout(BATCH_WAIT_MS);
  // 식별자를 보이고 복사하고 철회하는 동안 만든 요청 중 외부로 나간 것도, 식별자를 담은 것도 없다.
  expect(probe.outside.filter((line) => !line.startsWith("POST "))).toEqual([]);
  expect(probe.allUrls.slice(requestsBefore).some((url) => url.includes(String(sentId)))).toBe(false);

  await page.reload(); // 화면을 떠나면 사라진다
  await expect(page.getByRole("textbox", { name: "방금 지운 통계 식별자" })).toHaveCount(0);
});
