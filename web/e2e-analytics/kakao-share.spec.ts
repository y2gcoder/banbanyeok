import { type BrowserContext, devices, expect, type Page, test } from "@playwright/test";
import { FAKE_ROOM_ID, prepareRoom } from "../e2e/support/room-fixture";

// 카카오 앱 키(가짜, 형식만 맞음)를 박아 빌드한 앱에서 "카톡으로 보내기"가 카카오톡 공유 API로 가는지 본다. SDK는 카카오 CDN의 실제
// 파일을 받고(SRI 해시가 맞아야 실행된다), SDK가 카카오로 보내는 요청(모바일: 템플릿 확인 API, PC: 공유 창 폼)은 브라우저에서 가로채
// 내용을 검사한 뒤 막는다. 카카오 서버에는 SDK 파일 요청 말고는 닿지 않는다.

const SDK_URL = "https://t1.kakaocdn.net/kakao_js_sdk/2.8.4/kakao.min.js";
const KAKAO = /^https:\/\/([a-z0-9-]+\.)*(kakao\.com|kakaocdn\.net)\//;

type Template = {
  object_type: string;
  content: { title: string; description: string; image_url: string; link: Record<string, string> };
  buttons: { title: string; link: Record<string, string> }[];
};

type Probe = {
  /** 카카오로 나간 요청("메서드 주소"). SDK 파일은 실제로 받고 나머지는 막는다. */
  kakao: string[];
  templates: Template[];
  shares: { url?: string }[];
  csp: string[];
};

async function attach(context: BrowserContext, page: Page): Promise<Probe> {
  const probe: Probe = { kakao: [], templates: [], shares: [], csp: [] };
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
    if (url.host === "kapi.kakao.com" && url.pathname === "/v2/api/kakaolink/talk/template/default") {
      probe.templates.push(JSON.parse(url.searchParams.get("template_object") ?? "{}") as Template);
    }
    if (url.host === "sharer.kakao.com" && request.method() === "POST") {
      const params = new URLSearchParams(request.postData() ?? "");
      const linkObj = JSON.parse(params.get("validation_params") ?? "{}") as { template_object?: Template };
      if (linkObj.template_object) probe.templates.push(linkObj.template_object);
    }
    return route.fulfill({
      status: 400,
      headers: { "access-control-allow-origin": "*" },
      contentType: "application/json",
      body: '{"code":-2}',
    });
  });
  await page.exposeFunction("recordShare", (data: { url?: string }) => probe.shares.push(data));
  await page.addInitScript(() => {
    const record = (window as unknown as { recordShare: (data: ShareData) => Promise<void> }).recordShare;
    Object.defineProperty(navigator, "share", { value: (data: ShareData) => record(data), configurable: true });
  });
  return probe;
}

async function pickStation(page: Page, field: string, query: string, option: RegExp) {
  await page.getByRole("combobox", { name: field }).fill(query);
  await page.getByRole("option", { name: option }).click();
}

/** 화면이 다 뜬 뒤에도 카카오로 아무것도 가지 않았는지(SDK는 누를 때 받는다). */
async function expectNoKakaoYet(page: Page, probe: Probe) {
  await page.waitForLoadState("networkidle");
  expect(probe.kakao).toEqual([]);
  await expect(page.locator('script[src*="kakaocdn"]')).toHaveCount(0);
}

test("방: 열 때는 카카오로 아무것도 가지 않고, 첫 누름에 SDK를 받아 그 방의 지금 결과를 버튼과 함께 보낸다", async ({
  context,
  page,
  baseURL,
}) => {
  const probe = await attach(context, page);
  await page.goto(await prepareRoom(page, "host-full", 5));
  const button = page.getByRole("button", { name: "카톡으로 결과 보내기" });
  await expect(button).toBeVisible();
  await expectNoKakaoYet(page, probe);

  await button.click();
  await expect.poll(() => probe.templates.length, { timeout: 15_000 }).toBe(1);
  expect(probe.kakao[0]).toBe(`GET ${SDK_URL}`);
  const link = `${baseURL}/r/${FAKE_ROOM_ID}?sv=5`;
  expect(probe.templates[0]).toMatchObject({
    object_type: "feed",
    content: {
      title: "지금은 동대문역사문화공원이 제일 공평해요",
      description: "아직이면 출발역 넣어 주세요 · 민수 22분 · 참가자 2 21분 · 지연이와 함께 오는 아주 긴 이름 19분",
      image_url: `${baseURL}/r/${FAKE_ROOM_ID}/og?sv=5&dv=20261114.5`,
      link: { web_url: link, mobile_web_url: link },
    },
    buttons: [{ title: "내 출발역 넣기", link: { web_url: link, mobile_web_url: link } }],
  });
  expect(JSON.stringify(probe.templates[0])).not.toContain("신촌");
  expect(probe.shares).toEqual([]);
  expect(probe.csp).toEqual([]);
});

test("혼자 입력한 결과도 카카오톡 공유 API로 보내고, 링크는 받는 사람의 /s 주소다", async ({
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
  await expect(button).toBeVisible();
  await expectNoKakaoYet(page, probe);

  await button.click();
  await expect.poll(() => probe.templates.length, { timeout: 15_000 }).toBe(1);
  const template = probe.templates[0];
  expect(template?.content.title).toMatch(/에서 볼까\?$/);
  expect(template?.content.link.web_url).toMatch(new RegExp(`^${baseURL}/s\\?v=`));
  expect(template?.content.image_url).toMatch(new RegExp(`^${baseURL}/s/og\\?v=.*&dv=`));
  expect(template?.buttons).toEqual([{ title: "결과 보기", link: template?.content.link }]);
  expect(probe.shares).toEqual([]);
  expect(probe.csp).toEqual([]);
});

test("SDK를 못 받으면 그 누름은 지금처럼 공유 시트로 번호 붙은 방 링크를 보낸다", async ({
  context,
  page,
  baseURL,
}) => {
  const probe = await attach(context, page);
  await context.route(SDK_URL, (route) => route.abort());
  await page.goto(await prepareRoom(page, "host-full", 5));
  const button = page.getByRole("button", { name: "카톡으로 결과 보내기" });
  await expect(button).toBeVisible();
  await expectNoKakaoYet(page, probe);

  await button.click();
  await expect.poll(() => probe.shares.length).toBe(1);
  expect(probe.shares[0]?.url).toBe(`${baseURL}/r/${FAKE_ROOM_ID}?sv=5`);
  expect(probe.templates).toEqual([]);
});

test.describe("PC", () => {
  const { defaultBrowserType: _, ...desktop } = devices["Desktop Chrome"];
  test.use(desktop);

  test("누르면 카카오 공유 창을 열고 같은 메시지를 폼으로 보낸다(CSP form-action 허용)", async ({
    context,
    page,
    baseURL,
  }) => {
    const probe = await attach(context, page);
    await page.goto(await prepareRoom(page, "host-full", 5));
    const button = page.getByRole("button", { name: "카톡으로 결과 보내기" });
    await expect(button).toBeVisible();
    await expectNoKakaoYet(page, probe);

    const popup = page.waitForEvent("popup");
    await button.click();
    expect((await popup).url()).toMatch(/^https:\/\/sharer\.kakao\.com\/picker\/link/);
    await expect.poll(() => probe.templates.length, { timeout: 15_000 }).toBe(1);
    const link = `${baseURL}/r/${FAKE_ROOM_ID}?sv=5`;
    expect(probe.templates[0]?.content.link).toEqual({ web_url: link, mobile_web_url: link });
    expect(probe.templates[0]?.buttons).toEqual([
      { title: "내 출발역 넣기", link: { web_url: link, mobile_web_url: link } },
    ]);
    expect(probe.shares).toEqual([]);
    expect(probe.csp).toEqual([]);
  });
});
