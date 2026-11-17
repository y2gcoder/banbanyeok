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
/** SDK가 스스로 보내도 되는 이벤트(contracts/events.json `sdkEvents`): 오류 추적·웹 바이탈. */
const SDK_EVENTS = ["$exception", "$web_vitals"];

type Captured = { event: string; properties: Record<string, unknown> };

/** SDK가 이벤트마다 만드는 무작위 ID. 3글자 역 코드와 우연히 겹칠 수 있어(예: `k3ar3rttz4nfmapi`) 부분 문자열 검사에서만 뺀다. */
const RANDOM_ID_KEYS = ["$insert_id"];

function withoutRandomIds(properties: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(properties).filter(([key]) => !RANDOM_ID_KEYS.includes(key)));
}

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
const collectBox = (page: Page) => banner(page).getByRole("checkbox", { name: /이용 통계 수집·이용에 동의/ });
const transferBox = (page: Page) => banner(page).getByRole("checkbox", { name: /PostHog, Inc.로 통계 전송에 동의/ });
const saveButton = (page: Page) => banner(page).getByRole("button", { name: /^(동의하고 닫기|이대로 닫기)$/ });
/** 둘 다 체크했을 때의 오른쪽 버튼(정확히 "동의하고 닫기"). */
const agreeButton = (page: Page) => banner(page).getByRole("button", { name: "동의하고 닫기", exact: true });
const collectSwitch = (page: Page) => page.getByRole("switch", { name: "이용 통계 수집·이용 동의" });
const transferSwitch = (page: Page) => page.getByRole("switch", { name: /국외 이전 동의/ });

/** 배너에서 두 항목을 모두 체크하고 저장한다(둘 다 동의해야 통계가 켜진다). */
async function acceptAll(page: Page) {
  await collectBox(page).check();
  await transferBox(page).check();
  await agreeButton(page).click();
}

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
  await expect(page).toHaveURL(/\/result\?v=2&o=[0-9a-z]{3}\.[0-9a-z]{3}/);
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
  await banner(page).getByRole("button", { name: "모두 거부" }).click();
  await expect(banner(page)).toHaveCount(0);
  await useApp(page);
  await page.reload();
  await expect(page.getByRole("article").first().getByText("1위")).toBeVisible();
  await expect(banner(page)).toHaveCount(0);
  await page.waitForTimeout(BATCH_WAIT_MS);

  expect(probe.outside).toEqual([]);
  expect(await analyticsKeys(page)).toEqual([]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("bby.analytics.consent") ?? "{}"))).toMatchObject({
    v: 4,
    collect: false,
    transfer: false,
  });
});

test("동의: 그때부터 수집 주소로만, 계약의 이벤트만, 출발역·이름·쿼리 없이 나간다", async ({
  page,
  context,
  baseURL,
}) => {
  const probe = await attachProbe(context, baseURL ?? "");
  // CSP(connect-src에 통계 호스트만 허용)가 동의 뒤의 전송을 막지 않는지: 위반 메시지가 없어야 한다.
  const cspViolations: string[] = [];
  page.on("console", (message) => {
    if (/content security policy/i.test(message.text())) cspViolations.push(message.text());
  });
  await page.goto("/");
  expect(probe.outside).toEqual([]); // 배너가 떠 있는 동안
  await acceptAll(page);
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

  expect(cspViolations).toEqual([]);
  // 나간 요청은 수집 주소 하나뿐(/flags·원격 설정·녹화·설문 스크립트·확장 스크립트 없음).
  expect([...new Set(probe.outside)]).toEqual([`POST ${COLLECT}`]);
  // SDK 자동 이벤트는 오류·웹 바이탈만(있을 수도 없을 수도 있다). 나머지는 우리 이벤트.
  const sdk = probe.events.filter((e) => e.event.startsWith("$"));
  expect(sdk.filter((e) => !SDK_EVENTS.includes(e.event))).toEqual([]);
  const ours = probe.events.filter((e) => !e.event.startsWith("$"));
  expect(new Set(ours.map((e) => e.event))).toEqual(
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
  expect(ours[0]?.event).toBe("analytics_consent_changed"); // 동의한 순간이 첫 이벤트다(그 전 이벤트는 없다)

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
    const text = JSON.stringify(withoutRandomIds(rest));
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

test("인원 상한: 동의 전에는 안내 버튼을 눌러도 요청 0건, 동의한 뒤에는 people_limit_hit 한 번만(출발역·이름 없이)", async ({
  page,
  context,
  baseURL,
}) => {
  const probe = await attachProbe(context, baseURL ?? "");
  const fillToLimit = async () => {
    await page.getByRole("button", { name: /한 명 더/ }).click();
    await page.getByRole("button", { name: /한 명 더/ }).click();
  };
  const limitButton = page.getByRole("button", { name: "4명까지 돼요 · 더 필요해요?" });

  await page.goto("/");
  await fillToLimit();
  await limitButton.click();
  await limitButton.click();
  await expect(page.getByText("지금은 4명까지예요. 더 필요하다는 의견을 모으고 있어요.")).toBeVisible();
  await page.waitForTimeout(BATCH_WAIT_MS);
  expect(probe.outside).toEqual([]); // 동의 전: 아무것도 보내지 않는다

  await acceptAll(page);
  await expect.poll(() => probe.events.map((e) => e.event), { timeout: 15_000 }).toContain("analytics_consent_changed");
  // 동의 전에 누른 화면에서는 이미 지나간 일이라 보내지 않는다. 새 화면(새로 연 페이지)에서 누르면 그때부터 센다.
  await page.goto("/");
  await expect(banner(page)).toHaveCount(0);
  await page.getByRole("textbox", { name: "1번째 사람 이름(선택)" }).fill("민수");
  await fillToLimit();
  await limitButton.click();
  await limitButton.click();
  await limitButton.click();
  await expect
    .poll(() => probe.events.filter((e) => e.event === "people_limit_hit").length, { timeout: 15_000 })
    .toBe(1);
  await page.waitForTimeout(BATCH_WAIT_MS);

  const hits = probe.events.filter((e) => e.event === "people_limit_hit");
  expect(hits).toHaveLength(1);
  expect(hits[0]?.properties).toMatchObject({ surface: "home", attempted: 5, platform: "web" });
  expect(JSON.stringify(hits[0]?.properties)).not.toContain("민수");
});

test("철회: /privacy에서 끄면 바로 멈추고 저장된 식별자를 지운다, 다시 켜면 그때부터 다시 보낸다", async ({
  page,
  context,
  baseURL,
}) => {
  const probe = await attachProbe(context, baseURL ?? "");
  await page.goto("/");
  await acceptAll(page);
  await expect.poll(() => probe.events.length, { timeout: 15_000 }).toBeGreaterThan(0);
  expect(await analyticsKeys(page)).not.toEqual([]); // 동의한 뒤에는 식별자가 있다

  // 하단 "통계 설정" 링크로 간다(클라이언트 이동이 아니므로 새로 불러온다).
  await page.getByRole("link", { name: "통계 설정" }).click();
  await expect(page).toHaveURL(/\/privacy#analytics-settings$/);
  await expect(collectSwitch(page)).toHaveAttribute("aria-checked", "true");
  await expect(transferSwitch(page)).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("모두 동의함 — 이용 통계를 모으고 있어요.")).toBeVisible();

  await transferSwitch(page).click(); // 어느 항목이든 하나만 꺼도 즉시 멈춘다
  await expect(transferSwitch(page)).toHaveAttribute("aria-checked", "false");
  await expect(page.getByText(/일부만 동의함/)).toBeVisible();
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
  await transferSwitch(page).click(); // 수집·이용은 그대로 켜져 있으므로 국외 이전을 다시 켜면 둘 다 동의다
  await expect.poll(() => probe.outside.length, { timeout: 15_000 }).toBeGreaterThan(settled);
  expect(probe.events.at(-1)?.event).toBe("analytics_consent_changed");
});

test("다른 탭에서 철회해도 이 탭의 수집이 멈춘다", async ({ page, context, baseURL }) => {
  const probe = await attachProbe(context, baseURL ?? "");
  await page.goto("/");
  await acceptAll(page);
  await expect.poll(() => probe.events.length, { timeout: 15_000 }).toBeGreaterThan(0);

  const other = await context.newPage();
  await other.goto("/privacy");
  await other.getByRole("switch", { name: "이용 통계 수집·이용 동의" }).click();
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
        JSON.stringify({ v: 4, collect: true, transfer: true, at: "2026-11-14T00:00:00Z" }),
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
    await expect(collectSwitch(page)).toBeDisabled();
    await expect(transferSwitch(page)).toBeDisabled();
  });
}

test("배너 접근성: axe 위반 0, 기본 해제, 키보드로 고를 수 있고 모바일에서 과하게 크지 않다", async ({ page }) => {
  await page.goto("/");
  const region = banner(page);
  await expect(region).toBeVisible();
  await expect(collectBox(page)).not.toBeChecked();
  await expect(transferBox(page)).not.toBeChecked();
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);

  const box = await region.boundingBox();
  const viewport = page.viewportSize();
  expect(box && viewport && box.height < viewport.height * 0.45).toBe(true);
  expect(box && viewport && box.y + box.height <= viewport.height + 1).toBe(true); // 화면 아래에 붙어 있다

  // 거부·저장 버튼 크기가 같다(같은 무게).
  const reject = await region.getByRole("button", { name: "모두 거부" }).boundingBox();
  const save = await saveButton(page).boundingBox();
  expect(reject?.width).toBeCloseTo(save?.width ?? -1, 0);
  expect(reject?.height).toBeCloseTo(save?.height ?? -1, 0);

  // 키보드: 체크박스에서 Space로 체크하고, Tab으로 옮겨 Enter로 저장한다.
  await collectBox(page).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("Tab");
  await expect(transferBox(page)).toBeFocused();
  await page.keyboard.press("Space");
  await page.keyboard.press("Tab");
  await expect(region.getByRole("button", { name: "모두 거부" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(agreeButton(page)).toBeFocused(); // 둘 다 체크했으니 정확히 "동의하고 닫기"
  await page.keyboard.press("Enter");
  await expect(banner(page)).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("bby.analytics.consent") ?? "{}"))).toMatchObject({
    collect: true,
    transfer: true,
  });
});

test("분리 동의: 한 항목만 동의하면(수집·이용만, 국외 이전만) 요청 0건이고 다시 묻지 않는다", async ({
  page,
  context,
  baseURL,
}) => {
  const probe = await attachProbe(context, baseURL ?? "");
  await page.goto("/");
  await collectBox(page).check();
  await saveButton(page).click(); // 국외 이전은 해제 → 통계는 켜지지 않는다
  await expect(banner(page)).toHaveCount(0);
  await useApp(page);
  await page.waitForTimeout(BATCH_WAIT_MS);
  expect(probe.outside).toEqual([]);
  expect(await analyticsKeys(page)).toEqual([]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("bby.analytics.consent") ?? "{}"))).toMatchObject({
    collect: true,
    transfer: false,
  });

  // /privacy에서 나머지 항목을 켜면 그때부터 수집한다.
  await page.goto("/privacy");
  await expect(page.getByText(/일부만 동의함/)).toBeVisible();
  await transferSwitch(page).click();
  await expect(page.getByText("모두 동의함 — 이용 통계를 모으고 있어요.")).toBeVisible();
  await expect.poll(() => probe.events.map((e) => e.event), { timeout: 15_000 }).toContain("analytics_consent_changed");
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
  await acceptAll(page);
  await expect.poll(() => probe.events.length, { timeout: 15_000 }).toBeGreaterThan(0);
  const sentId = probe.events[0]?.properties.distinct_id;
  expect(typeof sentId).toBe("string");

  await page.getByRole("link", { name: "통계 설정" }).click();
  const box = page.getByRole("textbox", { name: "이 브라우저의 통계 식별자" });
  await expect(box).toHaveValue(String(sentId));
  await expect(page.getByText(/철회하기 전에 이 값을 복사해 privacy@banbanyeok\.app/)).toBeVisible();
  await page.getByRole("button", { name: "복사", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(sentId);
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);

  const requestsBefore = probe.allUrls.length;
  await collectSwitch(page).click();
  const cleared = page.getByRole("textbox", { name: "방금 지운 통계 식별자" });
  await expect(cleared).toHaveValue(String(sentId)); // 삭제 요청에 쓰도록 이 화면에는 남는다
  // 철회 직후에도 그 값을 복사할 수 있다(메모리에만, 저장소에는 없다).
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await page.getByRole("button", { name: "복사", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(sentId);
  expect(
    await page.evaluate((id) => JSON.stringify({ ...localStorage, ...sessionStorage }).includes(id), String(sentId)),
  ).toBe(false);
  expect(await analyticsKeys(page)).toEqual([]); // 기기에서는 지워졌다
  await page.waitForTimeout(BATCH_WAIT_MS);
  // 식별자를 보이고 복사하고 철회하는 동안 만든 요청 중 외부로 나간 것도, 식별자를 담은 것도 없다.
  expect(probe.outside.filter((line) => !line.startsWith("POST "))).toEqual([]);
  expect(probe.allUrls.slice(requestsBefore).some((url) => url.includes(String(sentId)))).toBe(false);

  await page.reload(); // 새로 고치면(화면을 떠나면) 남지 않는다
  await expect(page.getByRole("textbox", { name: "방금 지운 통계 식별자" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "이 브라우저의 통계 식별자" })).toHaveCount(0);
});

// 방 흐름의 통계. 방 API는 같은 출처 요청을 가로채 흉내 낸다(가짜 서버는 방을 구현하지 않는다). 방 ID·토큰은 이벤트 속성과
// URL 속성 어디에도 없어야 하고, 방 이벤트 3종(room_created·participant_joined·outcome_answered)은 동의한 뒤에만 나간다.
const FAKE_ROOM = "qt7yvmsht3";
/** 서버가 주는 통계용 방 해시(형식만 맞춘 가짜). 방 ID와 다르다. */
const FAKE_ROOM_HASH = "0f1e2d3c4b5a6978";
const FAKE_TOKENS = {
  host: "ptok-host-secret-value",
  friend: "ptok-friend-secret-value",
  hostRoom: "htok-host-secret-value",
};

async function fakeRoomApi(page: Page) {
  let friendJoined = false;
  const json = (status: number, body: unknown) => ({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
  const expiresAt = "2999-01-01T00:00:00Z";
  const people = (bearer: string | null) => [
    {
      participantId: "h1",
      hidden: false,
      originCode: "k3a",
      originName: "강남",
      label: "민수",
      labelKind: "name",
      shortLabel: "민수",
      nickname: "민수",
      isHost: true,
      isSelf: bearer === `Bearer ${FAKE_TOKENS.host}`,
    },
    ...(friendJoined
      ? [
          {
            participantId: "f1",
            hidden: true,
            originCode: bearer === `Bearer ${FAKE_TOKENS.friend}` ? "ryf" : null,
            originName: bearer === `Bearer ${FAKE_TOKENS.friend}` ? "홍대입구" : null,
            label: "참가자 2",
            labelKind: "ordinal",
            shortLabel: "참가자 2",
            isHost: false,
            isSelf: bearer === `Bearer ${FAKE_TOKENS.friend}`,
          },
        ]
      : []),
  ];
  await page.route("**/api/v1/rooms**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    const bearer = request.headers().authorization ?? null;
    if (request.method() === "POST" && path === "/rooms") {
      return route.fulfill(
        json(201, {
          roomId: FAKE_ROOM,
          hostToken: FAKE_TOKENS.hostRoom,
          participantId: "h1",
          participantToken: FAKE_TOKENS.host,
          expiresAt,
          roomHash: FAKE_ROOM_HASH,
        }),
      );
    }
    if (request.method() === "POST" && path.endsWith("/participants")) {
      friendJoined = true;
      return route.fulfill(json(201, { participantId: "f1", participantToken: FAKE_TOKENS.friend }));
    }
    if (request.method() === "POST" && path.endsWith("/outcome")) return route.fulfill({ status: 204 });
    if (request.method() === "GET" && path.endsWith("/result")) {
      return route.fulfill(
        json(200, {
          status: "ok",
          mode: "fair",
          dataVersion: "20261114.5",
          participants: people(bearer),
          baselineStationCode: "1qs",
          candidates: [
            {
              rank: 1,
              stationCode: "1qs",
              stationName: "신촌",
              times: [
                { participantId: "h1", seconds: 1000, transfers: 0 },
                ...(friendJoined ? [{ participantId: "f1", seconds: 1100, transfers: 1 }] : []),
              ],
              maxSeconds: 1100,
              spreadSeconds: 100,
              totalSeconds: 2100,
              reasonCode: "FAIR_MINIMAX",
              reason: "가장 오래 걸리는 참가자 2도 18분이에요.",
            },
          ],
        }),
      );
    }
    if (request.method() === "GET" && path === `/rooms/${FAKE_ROOM}`) {
      return route.fulfill(
        json(200, {
          roomId: FAKE_ROOM,
          mode: "fair",
          locked: false,
          expiresAt,
          dataVersion: "20261114.5",
          participants: people(bearer),
          roomHash: FAKE_ROOM_HASH,
          createdAt: new Date(Date.now() - 90_000).toISOString(),
        }),
      );
    }
    return route.fulfill(json(404, { code: "NOT_FOUND", message: "없음" }));
  });
}

test("방: 만들기·참여·만났나 이벤트는 동의한 뒤에만, 방 ID·토큰·출발역 없이 나간다", async ({
  page,
  context,
  baseURL,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const probe = await attachProbe(context, baseURL ?? "");
  await fakeRoomApi(page);

  // 동의 전에 방을 만들고 참여해도 요청 0건
  await page.goto("/r/new");
  await page.getByRole("textbox", { name: "내 이름 (선택)" }).fill("민수");
  await pickStation(page, "내 출발역", "강남", /^강남\s?2호선/);
  await page.getByRole("button", { name: "방 만들기" }).click();
  await expect(page).toHaveURL(new RegExp(`/r/${FAKE_ROOM}$`));
  await page.waitForTimeout(BATCH_WAIT_MS);
  expect(probe.outside).toEqual([]);
  expect(await analyticsKeys(page)).toEqual([]);

  // 동의한 뒤: 내 기록을 지워 새 참여자처럼 열어 참여(숨기기)하고, 결과를 보고, 만났나에 답한다.
  await acceptAll(page);
  await page.waitForTimeout(BATCH_WAIT_MS); // 전체 페이지 이동 전에 배치를 비운다
  await page.evaluate((id) => localStorage.removeItem(`bby.room.${id}`), FAKE_ROOM);
  await page.goto("/r/new"); // 기억해 둔 "나"(민수·강남)가 미리 채워진다
  await expect(page.getByRole("combobox", { name: "내 출발역" })).toHaveValue("강남");
  await page.getByRole("button", { name: "방 만들기" }).click(); // room_created
  await expect(page).toHaveURL(new RegExp(`/r/${FAKE_ROOM}$`));
  await page.getByRole("button", { name: "링크 복사" }).click(); // share_clicked(room)
  await page.waitForTimeout(BATCH_WAIT_MS);
  await page.evaluate((id) => localStorage.removeItem(`bby.room.${id}`), FAKE_ROOM);
  await page.reload();
  await pickStation(page, "내 출발역", "ㅎㄷㅇㄱ", /^홍대입구\s?2호선/);
  await page.getByRole("checkbox", { name: /출발역 이름 숨기기/ }).check();
  await page.getByRole("button", { name: "참여하기" }).click(); // participant_joined
  await expect(page.getByRole("region", { name: "만날 역 후보" }).getByRole("article")).toBeVisible();
  const outcome = page.getByRole("region", { name: "실제로 어디서 만났어요?" });
  await outcome.getByText("약속이 끝났다면, 어디서 만났는지 알려 주기").click();
  await outcome.getByText("1위 역에서 만났어요").click();
  await outcome.getByRole("button", { name: "알려 주기" }).click(); // outcome_answered
  await expect(page.getByText("알려 줘서 고마워요")).toBeVisible();
  await expect.poll(() => probe.events.map((e) => e.event), { timeout: 20_000 }).toContain("outcome_answered");
  await page.waitForTimeout(BATCH_WAIT_MS);

  const byName = (name: string) => probe.events.filter((e) => e.event === name);
  expect(probe.events.map((e) => e.event)).toContain("room_created");
  expect(byName("room_created")).toHaveLength(1);
  expect(byName("room_created")[0]?.properties).toMatchObject({ hidden_used: false });
  expect(byName("participant_joined")[0]?.properties).toMatchObject({ hidden: true });
  expect(byName("outcome_answered")[0]?.properties).toMatchObject({ outcome: "top1", meeting_station_code: "1qs" });
  expect(byName("share_clicked")[0]?.properties).toMatchObject({ link_type: "room" });
  expect(byName("outcome_answered")[0]?.properties.days_since_result).toBe(0);
  // 방은 서버가 준 room_hash로만 참조한다(방 ID 원문이 아니다). 참여까지 걸린 시간은 방 생성 시각에서 센다.
  for (const name of ["room_created", "participant_joined", "outcome_answered", "share_clicked", "result_viewed"]) {
    const properties = byName(name)[0]?.properties;
    expect(properties?.room_hash, name).toBe(FAKE_ROOM_HASH);
    expect(properties?.room_hash, name).not.toBe(FAKE_ROOM);
  }
  const waited = byName("participant_joined")[0]?.properties.seconds_since_room_created;
  expect(typeof waited).toBe("number");
  expect(waited).toBeGreaterThanOrEqual(90);

  // 방 ID·토큰·출발역·이름은 어떤 이벤트 어디에도 없다(속성 이름, 값, URL 속성 모두).
  const all = JSON.stringify(probe.events);
  expect(all).not.toContain(FAKE_ROOM);
  for (const secret of Object.values(FAKE_TOKENS)) expect(all).not.toContain(secret);
  expect(all).not.toMatch(/홍대입구|강남|민수/);
  for (const event of probe.events) {
    for (const key of Object.keys(event.properties)) expect(key).not.toMatch(FORBIDDEN_KEY);
    for (const value of Object.values(event.properties)) {
      if (typeof value === "string" && /^https?:\/\//.test(value)) expect(value).not.toMatch(/[?#]|\/r\/[0-9a-z]{10}/i);
    }
  }
  // 같은 출처 밖으로 나간 요청은 수집 주소 하나뿐
  expect([...new Set(probe.outside)]).toEqual([`POST ${COLLECT}`]);
});

test("오류 추적: 동의 전 오류는 요청 0건, 동의한 뒤 오류 1건은 방 ID·토큰·출발역·주소 뒷부분 없이 나간다", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(90_000); // 배치 대기와 페이지 이동이 여러 번 있다
  const probe = await attachProbe(context, baseURL ?? "");
  await fakeRoomApi(page);
  // 방을 만들어 이 기기에 방 기록(방 ID·토큰)이 있고 지금 방 주소를 보고 있는 상태로 만든다.
  await page.goto("/r/new");
  await page.getByRole("textbox", { name: "내 이름 (선택)" }).fill("민수");
  await pickStation(page, "내 출발역", "강남", /^강남\s?2호선/);
  await page.getByRole("button", { name: "방 만들기" }).click();
  await expect(page).toHaveURL(new RegExp(`/r/${FAKE_ROOM}$`));

  // 처리하지 못한 오류. 메시지에 방 ID·토큰·출발역이 담긴 공유 주소를 일부러 넣는다.
  const throwError = (label: string) =>
    page.evaluate(
      ([room, token, tag]) => {
        setTimeout(() => {
          throw new Error(
            `${tag} room ${room} failed at https://banbanyeok.example/result?v=2&o=k3a.ryf&n=%EB%AF%BC%EC%88%98 Bearer ${token}`,
          );
        }, 0);
      },
      [FAKE_ROOM, FAKE_TOKENS.host, label],
    );
  await throwError("before-consent");
  await page.waitForTimeout(BATCH_WAIT_MS);
  expect(probe.outside).toEqual([]); // 동의 전: 처리기도 없고 요청도 없다

  await acceptAll(page);
  await expect.poll(() => probe.events.map((e) => e.event), { timeout: 15_000 }).toContain("analytics_consent_changed");
  await throwError("after-consent");
  await expect.poll(() => probe.events.filter((e) => e.event === "$exception").length, { timeout: 20_000 }).toBe(1);
  await page.waitForTimeout(BATCH_WAIT_MS);

  const exceptions = probe.events.filter((e) => e.event === "$exception");
  expect(exceptions).toHaveLength(1); // 동의 전 오류는 나중에도 보내지 않는다
  const [exception] = exceptions;
  const text = JSON.stringify(exception);
  expect(text).toContain("after-consent");
  expect(text).not.toContain("before-consent");
  const scanned = JSON.stringify({ ...exception, properties: withoutRandomIds(exception?.properties ?? {}) });
  for (const needle of [FAKE_ROOM, ...Object.values(FAKE_TOKENS), "k3a", "ryf", "o=", "%EB%AF%BC", "민수", "강남"]) {
    expect(scanned, `$exception에 "${needle}"`).not.toContain(needle);
  }
  expect(exception?.properties).toMatchObject({ platform: "web", $geoip_disable: true });
  expect(String(exception?.properties.$current_url)).toMatch(/\/r\/\[room\]$/);
  const list = exception?.properties.$exception_list as { value?: string }[] | undefined;
  expect(list?.[0]?.value).toMatch(
    /after-consent room \[redacted\] failed at https:\/\/banbanyeok\.example\/result Bearer \[token\]/,
  );
  // 웹 바이탈: 방 주소로 새로 연 화면의 수치(첫 수치부터 5초 모아 보냄). 수치마다 붙은 주소도 방 ID 없이 나간다.
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`/r/${FAKE_ROOM}$`));
  await expect(page.getByRole("button", { name: "링크 복사" }).first()).toBeVisible();
  const roomVitals = () =>
    probe.events.filter((e) => e.event === "$web_vitals" && /\/r\/\[room\]$/.test(String(e.properties.$current_url)));
  await expect.poll(() => roomVitals().length, { timeout: 25_000 }).toBeGreaterThan(0);
  const vitals = probe.events.filter((e) => e.event === "$web_vitals");
  const vitalsText = JSON.stringify(vitals);
  // 동의한 페이지(/r/new에서 동의)의 수치는 보내지 않는다: 동의 전에 찍힌 LCP·FCP가 버퍼에서 나가지 않게.
  expect(vitals.filter((e) => String(e.properties.$current_url).endsWith("/r/new"))).toEqual([]);
  for (const needle of [FAKE_ROOM, ...Object.values(FAKE_TOKENS), "o="]) expect(vitalsText).not.toContain(needle);
  expect(roomVitals()[0]?.properties).toMatchObject({ platform: "web" });
  expect(Object.keys(roomVitals()[0]?.properties ?? {}).some((key) => /^\$web_vitals_[A-Z]+_value$/.test(key))).toBe(
    true,
  );

  // 오류·속도 이벤트도 수집 주소 하나로만 나간다(확장 스크립트를 따로 받지 않는다).
  expect([...new Set(probe.outside)]).toEqual([`POST ${COLLECT}`]);
  expect(probe.events.filter((e) => e.event.startsWith("$") && !SDK_EVENTS.includes(e.event))).toEqual([]);
});
