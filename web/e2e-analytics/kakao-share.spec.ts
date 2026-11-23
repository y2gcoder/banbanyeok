import { type BrowserContext, devices, expect, type Locator, type Page, test } from "@playwright/test";
import { FAKE_ROOM_ID, prepareRoom } from "../e2e/support/room-fixture";
import { ROOM_OG_IMAGE_VERSION, SITE_OG_IMAGE_PATH } from "../src/lib/copy/og-text";

// 카카오 앱 키(가짜, 형식만 맞음)를 박아 빌드한 앱에서 "카톡으로 보내기"가 카카오톡 공유 API로 가는지 본다. SDK는 카카오 CDN의 실제
// 파일을 받고(SRI 해시가 맞아야 실행된다), 카카오로 가는 요청(템플릿 확인 API, PC 공유 창 폼, iPhone 카카오톡 열기 주소)은 브라우저에서
// 가로채 내용을 검사하고 `kapi`대로 답한다. 카카오 서버에는 SDK 파일 요청 말고는 닿지 않는다.

const SDK_URL = "https://t1.kakaocdn.net/kakao_js_sdk/2.8.4/kakao.min.js";
const KAKAO = /^https:\/\/([a-z0-9-]+\.)*(kakao\.com|kakaocdn\.net)\//;
const LOGIN_URL = "https://accounts.kakao.com/login?continue=https%3A%2F%2Fsharer.kakao.com%2Fpicker%2Flink";
const TEMPLATE_CHECK = "GET https://kapi.kakao.com/v2/api/kakaolink/talk/template/default";

type Template = {
  object_type: string;
  content: { title: string; description: string; image_url: string; link: Record<string, string> };
  buttons: { title: string; link: Record<string, string> }[];
};

type Probe = {
  /** 카카오로 나간 요청("메서드 주소"). SDK 파일은 실제로 받고 나머지는 가로챈다. */
  kakao: string[];
  templates: Template[];
  /** 템플릿 확인 API에 답한 횟수. */
  answered: number;
  shares: { url?: string }[];
  /** 페이지가 시작한 이동(Navigation API)과 마지막 클릭에서 그때까지 걸린 ms. 카카오톡 열기와 카카오 오류 페이지 이동이 여기 잡힌다. */
  navigations: { url: string; sinceClickMs: number | null }[];
  csp: string[];
};

/** 카카오 템플릿 확인 API의 답. accept: 받음, reject: 앱 키·도메인 설정 오류(-401), unreachable: 카카오에 못 닿음. */
type KapiAnswer = "accept" | "reject" | "unreachable";

/** 공유 칸이 보일 때 카카오로 가는 확인. 이 방과 이용자의 글자는 없다. */
function expectContentFree(template: Template | undefined, baseURL: string | undefined) {
  const site = { web_url: `${baseURL}/`, mobile_web_url: `${baseURL}/` };
  expect(template).toEqual({
    object_type: "feed",
    content: {
      title: "반반역",
      description: "같이 만날 역 정해요",
      image_url: `${baseURL}${SITE_OG_IMAGE_PATH}`,
      image_width: 1200,
      image_height: 630,
      link: site,
    },
    buttons: [{ title: "반반역 열기", link: site }],
  });
}

/** 글자·숫자 값을 지운 템플릿 모양. */
const shape = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(shape)
    : value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, shape(inner)]))
      : typeof value;

async function attach(context: BrowserContext, page: Page, kapi: KapiAnswer = "accept"): Promise<Probe> {
  const probe: Probe = { kakao: [], templates: [], answered: 0, shares: [], navigations: [], csp: [] };
  context.on("request", (request) => {
    if (KAKAO.test(request.url())) probe.kakao.push(`${request.method()} ${request.url().split("?")[0]}`);
  });
  page.on("console", (message) => {
    if (/content security policy/i.test(message.text())) probe.csp.push(message.text());
  });
  await context.route(KAKAO, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.url() === SDK_URL) return route.continue();
    // iPhone에서 카카오톡을 여는 유니버설 링크. 204면 브라우저가 이 페이지에 머문다.
    if (url.host === "talk-apps.kakao.com") return route.fulfill({ status: 204 });
    if (url.host === "kapi.kakao.com" && url.pathname === "/v2/api/kakaolink/talk/template/default") {
      probe.templates.push(JSON.parse(url.searchParams.get("template_object") ?? "{}") as Template);
      if (kapi === "unreachable") {
        await route.abort("connectionrefused");
        probe.answered += 1;
        return;
      }
      if (kapi === "accept") {
        await route.fulfill({
          headers: { "access-control-allow-origin": "*" },
          contentType: "application/json",
          body: "{}",
        });
        probe.answered += 1;
        return;
      }
    }
    if (url.host === "sharer.kakao.com" && request.method() === "POST") {
      const params = new URLSearchParams(request.postData() ?? "");
      const linkObj = JSON.parse(params.get("validation_params") ?? "{}") as { template_object?: Template };
      if (linkObj.template_object) probe.templates.push(linkObj.template_object);
      // 카카오 계정에 로그인하지 않은 PC는 공유 창 폼이 로그인 화면으로 넘어간다(302). 브라우저는 폼 전송의 이동 경로 전체에 form-action을 적용한다.
      return route.fulfill({ status: 302, headers: { location: LOGIN_URL } });
    }
    if (url.host === "accounts.kakao.com") {
      return route.fulfill({ status: 200, contentType: "text/html", body: "<title>카카오계정</title>" });
    }
    await route.fulfill({
      status: 401,
      headers: { "access-control-allow-origin": "*" },
      contentType: "application/json",
      body: '{"code":-401,"msg":"appKey does not exist"}',
    });
    probe.answered += 1;
  });
  await page.exposeFunction("recordShare", (data: { url?: string }) => probe.shares.push(data));
  await page.exposeFunction("recordNavigation", (url: string, sinceClickMs: number | null) =>
    probe.navigations.push({ url, sinceClickMs }),
  );
  await page.addInitScript(() => {
    type Recorders = {
      recordShare: (data: ShareData) => Promise<void>;
      recordNavigation: (url: string, sinceClickMs: number | null) => void;
    };
    const { recordShare, recordNavigation } = window as unknown as Recorders;
    let clickedAt: number | null = null;
    document.addEventListener("click", () => (clickedAt = performance.now()), true);
    Object.defineProperty(navigator, "share", { value: (data: ShareData) => recordShare(data), configurable: true });
    const nav = (window as unknown as { navigation?: EventTarget }).navigation;
    nav?.addEventListener("navigate", (event) =>
      recordNavigation(
        (event as Event & { destination: { url: string } }).destination.url,
        clickedAt === null ? null : performance.now() - clickedAt,
      ),
    );
  });
  return probe;
}

async function pickStation(page: Page, field: string, query: string, option: RegExp) {
  await page.getByRole("combobox", { name: field }).fill(query);
  await page.getByRole("option", { name: option }).click();
}

/** 공유 칸이 첫 화면 밖이면, 화면이 다 떠도 카카오로 아무것도 가지 않는다. 칸까지 내린다. */
async function expectNothingUntilShown(page: Page, button: Locator, probe: Probe) {
  await page.waitForLoadState("networkidle");
  const below = await button.evaluate((element) => element.getBoundingClientRect().top >= window.innerHeight);
  expect(below, "공유 칸이 첫 화면 밖에 있어야 보이기 전을 볼 수 있다").toBe(true);
  expect(probe.kakao).toEqual([]);
  await expect(page.locator('script[src*="kakaocdn"]')).toHaveCount(0);
  await button.scrollIntoViewIfNeeded();
}

/** 공유 칸이 보이자 SDK 파일과 내용 없는 확인 하나가 갔고, 카카오가 답한 뒤까지(이용자가 칸을 보고 누르기까지) 기다린다. */
async function expectPrepared(page: Page, probe: Probe, baseURL: string | undefined) {
  await expect.poll(() => probe.answered, { timeout: 15_000 }).toBe(1);
  expect(probe.kakao).toEqual([`GET ${SDK_URL}`, TEMPLATE_CHECK]);
  expect(probe.templates).toHaveLength(1);
  expectContentFree(probe.templates[0], baseURL);
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 50)));
}

/** 누른 뒤의 이동과 카카오 요청만 보려고 지금까지 잡힌 이동을 비우고, 누르기 전 카카오 요청 수를 돌려준다. */
async function press(button: Locator, probe: Probe) {
  probe.navigations.length = 0;
  const before = probe.kakao.length;
  await button.click();
  return before;
}

const isTalkLaunch = (url: string) =>
  url.startsWith("intent://send?") || url.startsWith("https://talk-apps.kakao.com/scheme/kakaolink");

/**
 * 누르자 카카오톡을 열었고(안드로이드 크롬은 `intent://`, iPhone은 유니버설 링크), 이 페이지는 그대로다. 누른 뒤 카카오로 간 요청은 SDK가
 * 보내기 전에 하는 템플릿 확인 하나뿐이다(SDK를 받거나 미리 확인받느라 기다리지 않았다).
 */
async function expectTalkOpened(page: Page, probe: Probe, pageUrl: string, kakaoBefore: number) {
  await expect.poll(() => probe.navigations.some(({ url }) => isTalkLaunch(url)), { timeout: 15_000 }).toBe(true);
  expect(page.url()).toBe(pageUrl);
  expect(probe.navigations.filter(({ url }) => !isTalkLaunch(url) && url !== pageUrl)).toEqual([]);
  expect(probe.kakao.slice(kakaoBefore).filter((line) => !line.includes("talk-apps.kakao.com"))).toEqual([
    TEMPLATE_CHECK,
  ]);
  expect(probe.templates).toHaveLength(2);
  expect(shape(probe.templates[0]), "미리 받은 확인은 SDK가 보내는 메시지와 같은 모양").toEqual(
    shape(probe.templates[1]),
  );
  const launch = probe.navigations.find(({ url }) => isTalkLaunch(url));
  test.info().annotations.push({ type: "click-to-launch-ms", description: String(launch?.sinceClickMs?.toFixed(0)) });
  return probe.templates[1];
}

/** `offscreen`: 이 기기에서 방의 공유 칸이 첫 화면 밖에 있다. */
async function expectRoomMessage(probe: Probe, page: Page, baseURL: string | undefined, offscreen: boolean) {
  const button = page.getByRole("button", { name: "카톡으로 결과 보내기" });
  await expect(button).toBeAttached();
  const pageUrl = page.url();
  if (offscreen) await expectNothingUntilShown(page, button, probe);
  await expectPrepared(page, probe, baseURL);

  const template = await expectTalkOpened(page, probe, pageUrl, await press(button, probe));
  const link = `${baseURL}/r/${FAKE_ROOM_ID}?sv=5`;
  expect(template).toMatchObject({
    object_type: "feed",
    content: {
      title: "지금은 동대문역사문화공원이 제일 공평해요",
      description: "아직이면 출발역 넣어 주세요 · 민수 22분 · 참가자 2 21분 · 지연이와 함께 오는 아주 긴 이름 19분",
      // 그림 버전(iv)이 붙는다: 방 내용이 그대로여도 그리는 코드가 바뀌면 다시 공유한 메시지가 새 그림을 받는다.
      image_url: `${baseURL}/r/${FAKE_ROOM_ID}/og?sv=5&dv=20261114.5&iv=${ROOM_OG_IMAGE_VERSION}`,
      link: { web_url: link, mobile_web_url: link },
    },
    buttons: [{ title: "내 출발역 넣기", link: { web_url: link, mobile_web_url: link } }],
  });
  expect(JSON.stringify(template)).not.toContain("신촌");
  expect(probe.shares).toEqual([]);
  expect(probe.csp).toEqual([]);
}

test("방: 공유 칸이 화면에 있으면 SDK와 내용 없는 확인만 보내고, 첫 누름에 곧바로 카카오톡을 열어 그 방의 지금 결과를 보낸다", async ({
  context,
  page,
  baseURL,
}) => {
  const probe = await attach(context, page);
  await page.goto(await prepareRoom(page, "host-full", 5));
  await expectRoomMessage(probe, page, baseURL, false);
});

test("혼자 입력한 결과도 첫 누름에 곧바로 카카오톡 공유 API로 보내고, 링크는 받는 사람의 /s 주소다", async ({
  context,
  page,
  baseURL,
}) => {
  const probe = await attach(context, page);
  await page.goto("/");
  await page.getByRole("textbox", { name: "1번째 사람 이름(선택)" }).fill("민수");
  await pickStation(page, "민수의 출발역", "강남", /^강남\s?2호선/);
  await pickStation(page, "친구1의 출발역", "ㅎㄷㅇㄱ", /^홍대입구\s?2호선/);
  await page.getByRole("button", { name: "만날 역 찾기" }).click();
  const button = page.getByRole("button", { name: "카톡으로 보내기" });
  await expect(button).toBeAttached();
  const pageUrl = page.url();
  await expectNothingUntilShown(page, button, probe);
  await expectPrepared(page, probe, baseURL);

  const template = await expectTalkOpened(page, probe, pageUrl, await press(button, probe));
  expect(template?.content.title).toMatch(/에서 볼까\?$/);
  expect(template?.content.link.web_url).toMatch(new RegExp(`^${baseURL}/s\\?v=`));
  expect(template?.content.image_url).toMatch(new RegExp(`^${baseURL}/s/og\\?v=.*&dv=`));
  expect(template?.buttons).toEqual([{ title: "결과 보기", link: template?.content.link }]);
  expect(JSON.stringify(probe.templates[0])).not.toMatch(/민수|강남|홍대|\/s\?/);
  expect(probe.shares).toEqual([]);
  expect(probe.csp).toEqual([]);
});

test("SDK가 아직 오는 중에 누르면 기다리지 않고 공유 시트로 보내고, SDK가 온 뒤의 누름은 카카오톡을 연다", async ({
  context,
  page,
  baseURL,
}) => {
  const probe = await attach(context, page);
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await context.route(SDK_URL, async (route) => {
    await held;
    await route.continue();
  });
  await page.goto(await prepareRoom(page, "host-full", 5));
  const pageUrl = page.url();
  const button = page.getByRole("button", { name: "카톡으로 결과 보내기" });
  await button.scrollIntoViewIfNeeded();
  await expect.poll(() => probe.kakao).toEqual([`GET ${SDK_URL}`]);

  await press(button, probe);
  await expect.poll(() => probe.shares.length).toBe(1);
  expect(probe.shares[0]?.url).toBe(`${baseURL}/r/${FAKE_ROOM_ID}?sv=5`);
  expect(probe.templates).toEqual([]);
  expect(page.url()).toBe(pageUrl);
  expect(probe.navigations.filter(({ url }) => url !== pageUrl)).toEqual([]);

  release();
  await expect.poll(() => probe.answered, { timeout: 15_000 }).toBe(1);
  expectContentFree(probe.templates[0], baseURL);
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 50)));
  await expectTalkOpened(page, probe, pageUrl, await press(button, probe));
  expect(probe.shares).toHaveLength(1);
});

test("SDK를 못 받으면 누름은 지금처럼 공유 시트로 번호 붙은 방 링크를 보내고, 카카오에는 아무 내용도 가지 않는다", async ({
  context,
  page,
  baseURL,
}) => {
  const probe = await attach(context, page);
  await context.route(SDK_URL, (route) => route.abort());
  await page.goto(await prepareRoom(page, "host-full", 5));
  const pageUrl = page.url();
  const button = page.getByRole("button", { name: "카톡으로 결과 보내기" });
  await button.scrollIntoViewIfNeeded();
  await expect.poll(() => probe.kakao).toEqual([`GET ${SDK_URL}`]);
  await page.waitForLoadState("networkidle");

  await press(button, probe);
  await expect.poll(() => probe.shares.length).toBe(1);
  expect(probe.shares[0]?.url).toBe(`${baseURL}/r/${FAKE_ROOM_ID}?sv=5`);
  expect(probe.templates).toEqual([]);
  expect(page.url()).toBe(pageUrl);
});

for (const kapi of ["reject", "unreachable"] as const) {
  test(`카카오가 확인을 받지 않으면(${kapi}) 누름은 카카오 오류 페이지로 넘어가지 않고 공유 시트로 가며, 이 방의 메시지는 카카오로 가지 않는다`, async ({
    context,
    page,
    baseURL,
  }) => {
    const probe = await attach(context, page, kapi);
    await page.goto(await prepareRoom(page, "host-full", 5));
    const pageUrl = page.url();
    const button = page.getByRole("button", { name: "카톡으로 결과 보내기" });
    await button.scrollIntoViewIfNeeded();
    await expect.poll(() => probe.answered, { timeout: 15_000 }).toBe(1);
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 50)));

    await press(button, probe);
    await expect.poll(() => probe.shares.length).toBe(1);
    expect(probe.shares[0]?.url).toBe(`${baseURL}/r/${FAKE_ROOM_ID}?sv=5`);
    await page.waitForTimeout(500);
    expect(page.url()).toBe(pageUrl);
    expect(probe.navigations.filter(({ url }) => url !== pageUrl)).toEqual([]);
    for (const template of probe.templates) expectContentFree(template, baseURL);
  });
}

test("카카오가 거절하고 공유 시트도 열리지 않으면 이 페이지에서 링크 대화상자를 연다", async ({
  context,
  page,
  baseURL,
}) => {
  const probe = await attach(context, page, "reject");
  await page.addInitScript(() => {
    const share = () => Promise.reject(new DOMException("activation expired", "NotAllowedError"));
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
  });
  await page.goto(await prepareRoom(page, "host-full", 5));
  const pageUrl = page.url();
  const button = page.getByRole("button", { name: "카톡으로 결과 보내기" });
  await button.scrollIntoViewIfNeeded();
  await expect.poll(() => probe.answered, { timeout: 15_000 }).toBe(1);
  await press(button, probe);

  const dialog = page.getByRole("dialog", { name: "링크를 보내 주세요" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "링크" })).toHaveValue(`${baseURL}/r/${FAKE_ROOM_ID}?sv=5`);
  expect(page.url()).toBe(pageUrl);
  expect(probe.navigations.filter(({ url }) => url !== pageUrl)).toEqual([]);
});

test.describe("iPhone", () => {
  const { defaultBrowserType: _, ...iphone } = devices["iPhone 15"];
  test.use(iphone);

  test("공유 칸이 보일 때 준비해 두고, 첫 누름에 곧바로 유니버설 링크로 카카오톡을 연다", async ({
    context,
    page,
    baseURL,
  }) => {
    const probe = await attach(context, page);
    await page.goto(await prepareRoom(page, "host-full", 5));
    await expectRoomMessage(probe, page, baseURL, true);
    // Navigation API의 navigate는 이동 의도이고, context의 request 이벤트보다 먼저 도착할 수 있다.
    // expectRoomMessage가 이동을 확인했어도 실제 유니버설 링크 요청은 별도로 기다린다.
    await expect
      .poll(() => probe.kakao.some((line) => line.startsWith("GET https://talk-apps.kakao.com/scheme/kakaolink")))
      .toBe(true);
  });
});

test.describe("PC", () => {
  const { defaultBrowserType: _, ...desktop } = devices["Desktop Chrome"];
  test.use(desktop);

  test("첫 누름에 그 클릭 안에서 카카오 공유 창을 열고 같은 메시지를 폼으로 보낸다(CSP form-action 허용)", async ({
    context,
    page,
    baseURL,
  }) => {
    const probe = await attach(context, page);
    await page.goto(await prepareRoom(page, "host-full", 5));
    const button = page.getByRole("button", { name: "카톡으로 결과 보내기" });
    await button.scrollIntoViewIfNeeded();
    await expectPrepared(page, probe, baseURL);

    const popup = page.waitForEvent("popup");
    await button.click();
    const shareWindow = await popup;
    await expect
      .poll(() => probe.kakao.includes("POST https://sharer.kakao.com/picker/link"), { timeout: 15_000 })
      .toBe(true);
    // 로그인하지 않은 이용자의 공유 창은 카카오 로그인 화면까지 가야 한다. 비어 있는 about:blank로 남으면 안 된다.
    await expect.poll(() => shareWindow.url(), { timeout: 15_000 }).toMatch(/^https:\/\/accounts\.kakao\.com\/login/);
    expect(probe.templates).toHaveLength(2);
    const link = `${baseURL}/r/${FAKE_ROOM_ID}?sv=5`;
    expect(probe.templates[1]?.content.link).toEqual({ web_url: link, mobile_web_url: link });
    expect(probe.templates[1]?.buttons).toEqual([
      { title: "내 출발역 넣기", link: { web_url: link, mobile_web_url: link } },
    ]);
    expect(probe.shares).toEqual([]);
    expect(probe.csp).toEqual([]);
  });
});
