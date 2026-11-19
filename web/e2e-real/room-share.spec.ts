import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type APIRequestContext,
  type Browser,
  devices,
  expect,
  type Page,
  type TestInfo,
  test,
} from "@playwright/test";

/**
 * 방 공유 번호와 정한 역(#51) e2e: 실제 서버(Ktor + DB)에 붙은 웹에서 링크 번호(`?sv=`)가 단계마다 오르고, 크롤러가 받는 미리보기
 * (og:title·description·그림)가 방의 지금 단계를 보여 주며, 오래된 화면의 정하기·풀기는 409로 막히는지 본다.
 * ROOM_SHARE_SHOTS_DIR가 있으면 단계별 화면(320·390·768)과 미리보기 그림을 그 폴더에 남긴다.
 */
const shotsDir = process.env.ROOM_SHARE_SHOTS_DIR;
const WIDTHS = [320, 390, 768] as const;
/** 카카오톡 미리보기 수집기. Next는 이 UA에 메타데이터를 <head>에 넣어 준다(스트리밍하지 않음). */
const KAKAO_UA = "facebookexternalhit/1.1; kakaotalk-scrap/1.0; +https://devtalk.kakao.com/t/scrap/33984";
const SINCHON = "1qs";
const INVITE_TITLE = "같이 만날 역 정해요 | 반반역";
const ROOM_CHANGED = "그사이 방이 바뀌었어요. 새로 불러왔으니 다시 골라 주세요.";

async function shots(page: Page, name: string) {
  if (!shotsDir) return;
  mkdirSync(shotsDir, { recursive: true });
  const original = page.viewportSize();
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: resolve(shotsDir, `${name}-${width}.png`), fullPage: true });
  }
  if (original) await page.setViewportSize(original);
}

async function pickStation(page: Page, field: string, query: string, option: RegExp) {
  await page.getByRole("combobox", { name: field }).fill(query);
  await page.getByRole("option", { name: option }).click();
}

async function newFriend(browser: Browser, testInfo: TestInfo) {
  const context = await browser.newContext({
    ...devices["Pixel 7"],
    locale: "ko-KR",
    baseURL: testInfo.project.use.baseURL ?? "http://127.0.0.1:3000",
  });
  return { context, page: await context.newPage() };
}

/** 공유 칸의 "링크 복사"로 복사한 링크의 공유 번호. */
async function sharedVersion(page: Page, roomId: string): Promise<number> {
  await page.getByRole("button", { name: /^링크(를)? 복사/ }).click();
  const link = new URL(await page.evaluate(() => navigator.clipboard.readText()));
  expect(link.pathname).toBe(`/r/${roomId}`);
  expect([...link.searchParams.keys()]).toEqual(["sv"]);
  return Number(link.searchParams.get("sv"));
}

const decode = (text: string) =>
  text
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/** 크롤러처럼 링크 HTML을 받아 미리보기 값을 꺼낸다. */
async function scrape(request: APIRequestContext, path: string) {
  const html = await (await request.get(path, { headers: { "user-agent": KAKAO_UA } })).text();
  const meta = (property: string) =>
    decode(html.match(new RegExp(`<meta property="${property}" content="([^"]*)"`))?.[1] ?? "");
  return {
    html,
    title: meta("og:title"),
    description: meta("og:description"),
    image: meta("og:image"),
    noindex: /<meta name="robots" content="noindex, nofollow"/.test(html),
  };
}

/** 미리보기 그림을 받아 확인하고(방 카드는 하루 캐시) 남긴다. */
async function fetchImage(request: APIRequestContext, url: string, name: string) {
  const res = await request.get(new URL(url).pathname + new URL(url).search);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("image/png");
  if (shotsDir) writeFileSync(resolve(shotsDir, `og-${name}.png`), await res.body());
  return res.headers()["cache-control"];
}

test("방 공유: 단계마다 링크 번호와 미리보기가 바뀌고, 오래된 화면의 정하기·풀기는 409로 막힌다", async ({
  page,
  context,
  browser,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);

  // 방장이 방을 만든다(모으는 중).
  await page.goto("/r/new");
  await page.getByRole("textbox", { name: "내 이름 (선택)" }).fill("민수");
  await pickStation(page, "내 출발역", "강남", /^강남\s?2호선/);
  await page.getByRole("button", { name: "방 만들기" }).click();
  await expect(page).toHaveURL(/\/r\/[0-9a-hjkmnp-tv-z]{10}$/);
  const roomId = new URL(page.url()).pathname.split("/").pop() ?? "";
  await expect(page.getByRole("heading", { name: "친구에게 링크를 보내 주세요" })).toBeVisible();
  await expect(page.getByRole("button", { name: "카톡으로 보내기" })).toBeVisible();
  const collectingVersion = await sharedVersion(page, roomId);
  expect(collectingVersion).toBeGreaterThanOrEqual(1);
  await shots(page, "1-collecting-host");

  const collecting = await scrape(request, `/r/${roomId}?sv=${collectingVersion}`);
  expect(collecting.title).toBe(INVITE_TITLE);
  expect(collecting.image).toMatch(/\/opengraph-image\?v=[0-9a-f]{8}$/);
  expect(collecting.noindex).toBe(true);
  const plain = await scrape(request, `/r/${roomId}`);
  expect(plain.title).toBe(INVITE_TITLE);
  expect(plain.description).toBe(collecting.description);

  // 친구는 받은 링크(번호 포함)로 들어와 출발역을 숨기고 참여한다. 세 번째 사람(지연·신촌)은 API로 넣는다.
  const friend = await newFriend(browser, testInfo);
  await friend.page.goto(`/r/${roomId}?sv=${collectingVersion}`);
  await pickStation(friend.page, "내 출발역", "ㅎㄷㅇㄱ", /^홍대입구\s?2호선/);
  await friend.page.getByRole("checkbox", { name: /출발역 이름 숨기기/ }).check();
  await friend.page.getByRole("button", { name: "참여하기" }).click();
  await expect(friend.page.getByText("홍대입구 · 나에게만 보여요")).toBeVisible();
  const third = await request.post(`/api/v1/rooms/${roomId}/participants`, {
    data: { originCode: SINCHON, hidden: false, nickname: "지연" },
  });
  expect(third.status()).toBe(201);

  // 결과 단계: 링크 번호가 오르고, 미리보기는 지금 1위와 각자 시간(숨긴 사람은 "참가자 2", 숨긴 출발역 없음).
  await page.reload();
  await expect(page.getByRole("button", { name: "카톡으로 결과 보내기" })).toBeVisible();
  const resultVersion = await sharedVersion(page, roomId);
  expect(resultVersion).toBeGreaterThan(collectingVersion);
  const result = await scrape(request, `/r/${roomId}?sv=${resultVersion}`);
  expect(result.title).toMatch(/^지금은 .+(이|가) 제일 공평해요 \| 반반역$/);
  expect(result.description).toMatch(/^아직이면 출발역 넣어 주세요 · 민수 \d+분 · 참가자 2 \d+분 · 지연 \d+분$/);
  expect(result.html).not.toContain("홍대입구");
  expect(result.image).toContain(`/r/${roomId}/og?sv=${resultVersion}&dv=`);
  expect(await fetchImage(request, result.image, "result")).toBe("public, max-age=86400, s-maxage=86400");
  // 옛 번호의 링크도 지금 상태를 그리고, 지금보다 큰 번호는 기본 초대 문구다. 옛 번호의 그림 주소는 방 카드를 남기지 않는다.
  expect((await scrape(request, `/r/${roomId}?sv=${collectingVersion}`)).title).toBe(result.title);
  expect((await scrape(request, `/r/${roomId}?sv=${resultVersion + 100}`)).title).toBe(INVITE_TITLE);
  const staleImage = result.image.replace(`sv=${resultVersion}`, `sv=${collectingVersion}`);
  expect(await fetchImage(request, staleImage, "stale-sv")).toBe("public, max-age=60");
  await shots(page, "2-result-host");

  // 친구 화면을 지금 결과로 새로 그려 둔다(이 화면이 아래에서 오래된 화면이 된다).
  await friend.page.reload();
  await friend.page.getByRole("region", { name: "만날 역 후보" }).locator("details > summary").first().click(); // 2위 펼치기
  const friendDecide = friend.page.getByRole("button", { name: "이 역으로 정했어요" });
  await expect(friendDecide.nth(1)).toBeVisible();

  // 방장이 1위로 정한다. 정한 뒤 결과가 새 번호로 다시 올 때까지는 다른 역으로 바꿀 수 없다(옛 번호로 보내면 409).
  await page.getByRole("region", { name: "만날 역 후보" }).locator("details > summary").first().click(); // 2위 펼치기
  let releaseResult = () => {};
  const resultHeld = new Promise<void>((resolve) => {
    releaseResult = resolve;
  });
  await page.route("**/rooms/*/result**", async (route) => {
    await resultHeld;
    await route.continue().catch(() => {}); // 붙잡힌 사이 화면이 더 새 요청으로 바꿔 끊은 요청
  });
  await page.getByRole("button", { name: "이 역으로 정했어요" }).first().click();
  const banner = page.getByRole("region", { name: /에서 만나요$/ });
  await expect(banner).toBeVisible();
  await expect(banner.getByText("내가 정했어요")).toBeVisible();
  await expect(page.getByRole("button", { name: "이 역으로 바꾸기" }).first()).toBeDisabled();
  await expect(page.getByText("새 결과를 불러오는 중이에요.").first()).toBeVisible();
  await shots(page, "5-pending-host");
  releaseResult();
  await page.unroute("**/rooms/*/result**");
  await expect(page.getByRole("button", { name: "이 역으로 바꾸기" }).first()).toBeEnabled();

  // 친구의 오래된 화면에서 2위로 정하면 거절되고, 새로 불러온 뒤 안내한다.
  await friendDecide.nth(1).click();
  await expect(friend.page.getByRole("alert").filter({ hasText: ROOM_CHANGED })).toBeVisible();
  await expect(friend.page.getByRole("region", { name: /에서 만나요$/ }).getByText("민수가 정했어요")).toBeVisible();
  await shots(friend.page, "4-stale-friend-409");
  // 새로 불러온 화면에서는 바꿀 수 있다.
  await friend.page.getByRole("button", { name: "이 역으로 바꾸기" }).first().click();
  const friendBanner = friend.page.getByRole("region", { name: /에서 만나요$/ });
  await expect(friendBanner.getByText("내가 정했어요")).toBeVisible();
  const replacedHeading = (await friendBanner.getByRole("heading").textContent()) ?? "";

  // 방장 화면은 친구가 바꾼 것을 아직 못 봤다: 풀기가 거절되고, 새로 불러온 뒤에는 풀 수 있다.
  await banner.getByRole("button", { name: "정한 역 풀기" }).click();
  await expect(page.getByRole("alert").filter({ hasText: ROOM_CHANGED })).toBeVisible();
  await expect(page.getByRole("heading", { name: replacedHeading })).toBeVisible();
  await expect(page.getByText("참가자 2가 정했어요")).toBeVisible();
  await expect(page.getByRole("button", { name: "카톡으로 정한 역 알리기" })).toBeVisible();
  const decidedVersion = await sharedVersion(page, roomId);
  expect(decidedVersion).toBeGreaterThan(resultVersion);
  const decided = await scrape(request, `/r/${roomId}?sv=${decidedVersion}`);
  expect(decided.title).toBe(`${replacedHeading} | 반반역`);
  expect(decided.description).toMatch(/^참가자 2가 정했어요 · 민수 \d+분 · 참가자 2 \d+분 · 지연 \d+분$/);
  expect(decided.html).not.toContain("홍대입구");
  expect(await fetchImage(request, decided.image, "decided")).toBe("public, max-age=86400, s-maxage=86400");
  await shots(page, "3-decided-host");
  await shots(friend.page, "3-decided-friend");

  await page.getByRole("button", { name: "정한 역 풀기" }).click();
  await expect(page.getByRole("region", { name: /에서 만나요$/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "카톡으로 결과 보내기" })).toBeVisible();
  const undoneVersion = await sharedVersion(page, roomId);
  expect(undoneVersion).toBeGreaterThan(decidedVersion);
  expect((await scrape(request, `/r/${roomId}?sv=${undoneVersion}`)).title).toMatch(/제일 공평해요 \| 반반역$/);

  // 참여하지 않고 보는 사람에게는 정하기 버튼이 없다.
  const viewer = await newFriend(browser, testInfo);
  await viewer.page.goto(`/r/${roomId}`);
  await expect(viewer.page.getByRole("region", { name: "만날 역 후보" }).getByRole("article").first()).toBeVisible();
  await expect(viewer.page.getByRole("button", { name: /이 역으로/ })).toHaveCount(0);

  await Promise.all([friend.context.close(), viewer.context.close()]);
});
