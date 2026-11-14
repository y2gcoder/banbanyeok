import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
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
 * 방(각자 입력) 흐름 e2e: 실제 서버(Ktor + DB)에 붙은 웹을 대상으로 모바일 폭에서 확인한다.
 * 방장은 한 브라우저 컨텍스트, 친구는 따로 만든 컨텍스트(저장소·쿠키가 분리됨)로 움직인다.
 * UPDATE_SCREENSHOTS=1 이면 docs/setup/r1-screens/에 화면을 저장한다(PR·노트용).
 */
const shotsDir = resolve(import.meta.dirname, "../../docs/setup/r1-screens");
async function shot(page: Page, name: string) {
  if (!process.env.UPDATE_SCREENSHOTS) return;
  mkdirSync(shotsDir, { recursive: true });
  await page.screenshot({ path: resolve(shotsDir, `${name}.png`), fullPage: true });
}

async function pickStation(page: Page, field: string, query: string, option: RegExp) {
  await page.getByRole("combobox", { name: field }).fill(query);
  await page.getByRole("option", { name: option }).click();
}

/** 강남역 코드(dev 산출물). API로 직접 참여자를 넣을 때 쓴다. */
const GANGNAM = "k3a";
/** WCAG 2.1 AA 위반이 없어야 한다. */
async function expectNoA11yViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

/** 운영 빌드의 CSP를 어기는 일(인라인 스크립트 차단 등)이 없어야 한다. */
function watchCsp(page: Page): string[] {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/content security policy/i.test(message.text())) violations.push(message.text());
  });
  return violations;
}

const ROOM_URL = /\/r\/([0-9a-hjkmnp-tv-z]{10})$/;

async function newFriend(browser: Browser, testInfo: TestInfo) {
  const context = await browser.newContext({
    ...devices["Pixel 7"],
    locale: "ko-KR",
    baseURL: testInfo.project.use.baseURL ?? "http://127.0.0.1:3000",
  });
  return { context, page: await context.newPage() };
}

/** 방장이 방을 만든다(이름 "민수", 강남, 숨기지 않음). 방 ID를 돌려준다. */
async function createRoom(page: Page, options: { shot?: boolean } = {}): Promise<string> {
  const warmUp = page.waitForRequest((req) => req.url().endsWith("/api/healthz"));
  await page.goto("/");
  if (options.shot) await shot(page, "0-home");
  await page.getByRole("link", { name: /친구가 각자 입력하게 하기/ }).click();
  await expect(page).toHaveURL(/\/r\/new$/);
  await warmUp; // 방 만들기 화면이 열리면 서버를 깨운다.
  await page.getByRole("textbox", { name: "내 이름(선택)" }).fill("민수");
  await pickStation(page, "내 출발역", "강남", /^강남\s?2호선/);
  if (options.shot) {
    await page.getByRole("heading", { name: /방 만들기/ }).click(); // 자동완성 목록을 닫고 찍는다
    await shot(page, "1-create");
  }
  await page.getByRole("button", { name: "방 만들기" }).click();
  await expect(page).toHaveURL(ROOM_URL);
  return new URL(page.url()).pathname.split("/").pop() ?? "";
}

const storedRecord = (page: Page, roomId: string) =>
  page.evaluate(
    (id) => JSON.parse(window.localStorage.getItem(`bby.room.${id}`) ?? "null") as Record<string, string> | null,
    roomId,
  );

async function addParticipants(request: APIRequestContext, roomId: string, count: number) {
  for (let i = 0; i < count; i += 1) {
    const res = await request.post(`/api/v1/rooms/${roomId}/participants`, {
      data: { originCode: GANGNAM, hidden: false },
    });
    expect(res.status()).toBe(201);
  }
}

test("방 만들기 → 친구 참여(숨김) → 숨김 확인 → 결과 → 수정·삭제 → 만났나 → 방 삭제", async ({
  page,
  context,
  browser,
}, testInfo) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const csp = watchCsp(page);
  const hostRoom = await createRoom(page, { shot: true });

  // 방장 화면: 링크 보내기가 먼저, 혼자일 때는 결과가 아직 없다. 토큰은 이 기기 저장소에만 있고 주소에는 없다.
  await expect(page.getByRole("heading", { name: "내가 만든 방" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "친구에게 링크를 보내 주세요" })).toBeVisible();
  const people = page.getByRole("region", { name: "들어온 사람" });
  await expect(people.getByText("민수")).toBeVisible();
  await expect(people.getByText("(나)")).toBeVisible();
  await expect(people.getByText("방장")).toBeVisible();
  await expect(page.getByText("두 명 이상 들어오면 결과를 볼 수 있어요.")).toBeVisible();
  const hostRecord = await storedRecord(page, hostRoom);
  expect(hostRecord?.hostToken?.length).toBeGreaterThan(20);
  expect(hostRecord?.participantToken?.length).toBeGreaterThan(20);
  for (const secret of [hostRecord?.hostToken, hostRecord?.participantToken]) {
    expect(page.url()).not.toContain(secret ?? "never");
  }
  expect(await page.evaluate(() => document.cookie)).toBe("");
  await expectNoA11yViolations(page);
  await shot(page, "2-host-waiting");

  await page.getByRole("button", { name: "링크 복사" }).click();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(ROOM_URL);
  expect(link).not.toContain(hostRecord?.hostToken ?? "never");

  // 친구(다른 컨텍스트): 링크를 열면 방장이 보이고, 숨기기로 참여한다.
  const friend = await newFriend(browser, testInfo);
  await friend.page.goto(link);
  await expect(friend.page.getByRole("heading", { name: "나도 출발역 넣기" })).toBeVisible();
  const friendPeople = friend.page.getByRole("region", { name: "들어온 사람" });
  await expect(friendPeople.getByText("민수")).toBeVisible();
  await expect(friendPeople.getByText("강남", { exact: true })).toBeVisible();
  await expect(friendPeople.getByText("(나)")).toHaveCount(0);
  await expectNoA11yViolations(friend.page);
  await shot(friend.page, "3-friend-join");
  await pickStation(friend.page, "내 출발역", "ㅎㄷㅇㄱ", /^홍대입구\s?2호선/);
  await friend.page.getByRole("checkbox", { name: /출발역 이름 숨기기/ }).check();
  await shot(friend.page, "4-friend-join-hidden");
  await friend.page.getByRole("button", { name: "참여하기" }).click();

  // 친구 화면: 본인 줄에만 (나), 본인에게만 자기 출발역이 보인다. 결과가 나오고 길찾기는 만든 사람 쪽만.
  await expect(friendPeople.getByRole("listitem").filter({ hasText: "참가자 2" })).toBeVisible();
  await expect(friendPeople.getByText("(나)")).toBeVisible();
  await expect(friendPeople.getByText("홍대입구 · 나에게만 보여요")).toBeVisible();
  const friendResult = friend.page.getByRole("region", { name: "만날 역 후보" });
  await expect(friendResult.getByRole("article").first()).toBeVisible();
  await shot(friend.page, "5-friend-after-join");

  // 방장 화면은 새로 고치지 않아도 목록이 갱신된다(주기적 갱신). 숨긴 사람의 출발역은 어디에도 없다.
  const hostPeople = page.getByRole("region", { name: "들어온 사람" });
  await expect(hostPeople.getByRole("listitem").filter({ hasText: "참가자 2" })).toBeVisible({ timeout: 30_000 });
  await expect(hostPeople.getByText("출발역 비공개")).toBeVisible();
  await expect(hostPeople.getByText("홍대입구")).toHaveCount(0);
  const hostResult = page.getByRole("region", { name: "만날 역 후보" });
  const top = hostResult.getByRole("article").first();
  await expect(top.getByText("참가자 2", { exact: true })).toBeVisible();
  await expect(top.getByText("출발역 비공개")).toBeVisible(); // 시간·환승은 보이고 역 이름만 가려진다
  await expect(top.getByText("민수(나)")).toBeVisible();
  await expectNoA11yViolations(page);
  await shot(page, "6-host-with-result");

  // 서버 응답에도 숨긴 출발역 코드가 없다(방장·토큰 없는 사람 모두).
  const hostRoomBody = await page.evaluate(
    async ({ id, token }) =>
      await (await fetch(`/api/v1/rooms/${id}`, { headers: { authorization: `Bearer ${token}` } })).text(),
    { id: hostRoom, token: hostRecord?.participantToken ?? "" },
  );
  const parsed = JSON.parse(hostRoomBody) as {
    participants: { label: string; originCode: string | null; originName: string | null }[];
  };
  expect(parsed.participants.find((p) => p.label === "참가자 2")).toMatchObject({ originCode: null, originName: null });
  expect(hostRoomBody).not.toContain("홍대입구");

  // 토큰 없는 구경꾼도 같은 방을 보고 같은 숨김을 본다.
  const viewer = await newFriend(browser, testInfo);
  await viewer.page.goto(link);
  await expect(
    viewer.page.getByRole("region", { name: "들어온 사람" }).getByRole("listitem").filter({ hasText: "참가자 2" }),
  ).toBeVisible();
  await expect(viewer.page.getByRole("region", { name: "들어온 사람" }).getByText("홍대입구")).toHaveCount(0);
  await viewer.context.close();

  // 친구: 내 입력 수정(숨기기 풀고 다른 역)
  await friend.page.getByRole("button", { name: "수정 내 항목" }).click();
  await expect(friend.page.getByRole("heading", { name: "내 출발역 고치기" })).toBeVisible();
  await shot(friend.page, "7-friend-edit");
  await friend.page.getByRole("checkbox", { name: /출발역 이름 숨기기/ }).uncheck();
  await pickStation(friend.page, "내 출발역", "사당", /^사당\s?2호선/);
  await friend.page.getByRole("button", { name: "저장하기" }).click();
  await expect(friendPeople.getByText("출발역 비공개")).toHaveCount(0);
  await expect(friendPeople.getByText("사당에서 오는 분")).toBeVisible();
  await expect(friendPeople.getByText("(나)")).toBeVisible();
  // 방장은 이제 친구의 출발역이 보인다.
  await page.reload();
  await expect(
    page.getByRole("region", { name: "들어온 사람" }).getByRole("listitem").filter({ hasText: "사당에서 오는 분" }),
  ).toBeVisible();

  // 실제로 어디서 만났나(친구): 한 번 답하면 고마움 표시, 서버에 기록.
  const outcome = friend.page.getByRole("region", { name: "실제로 어디서 만났어요?" });
  await expect(outcome).toBeVisible();
  // 약속일을 정하지 않은 방은 질문이 접혀 있다.
  await expect(outcome.getByText("1위 역에서 만났어요")).toBeHidden();
  await outcome.getByText("약속이 끝났다면, 어디서 만났는지 알려 주기").click();
  await outcome.getByText("1위 역에서 만났어요").click();
  await shot(friend.page, "8-outcome");
  const answered = friend.page.waitForResponse((res) => res.url().endsWith(`/rooms/${hostRoom}/outcome`));
  await outcome.getByRole("button", { name: "알려 주기" }).click();
  expect((await answered).status()).toBe(204);
  await expect(friend.page.getByText("알려 줘서 고마워요")).toBeVisible();
  await friend.page.reload();
  await expect(friend.page.getByText("알려 줘서 고마워요")).toBeVisible(); // 다시 묻지 않는다

  // 친구: 내 항목 삭제 → 목록에서 빠지고 다시 참여할 수 있다. 이 기기의 참여자 토큰도 지워진다.
  await friend.page.getByRole("button", { name: "삭제 내 항목" }).click();
  await friend.page.getByRole("button", { name: "지우기" }).click();
  await expect(friend.page.getByRole("heading", { name: "나도 출발역 넣기" })).toBeVisible();
  await expect(friendPeople.getByText("(나)")).toHaveCount(0);
  expect(await storedRecord(friend.page, hostRoom)).toBeNull();

  // 방장: 방 삭제 → 홈으로, 이 기기의 토큰이 지워지고 링크는 "없는 방".
  await page.reload();
  await page.getByRole("button", { name: "방 삭제 방 전체" }).click();
  await page.getByRole("button", { name: "방 지우기" }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(await storedRecord(page, hostRoom)).toBeNull();
  await friend.page.goto(link);
  await expect(friend.page.getByRole("heading", { name: "찾을 수 없는 방이에요" })).toBeVisible();
  await friend.context.close();
  expect(csp).toEqual([]);
});

test("잠김·정원 초과: 새로 들어올 수 없고, 이미 들어온 사람은 계속 고칠 수 있다", async ({
  page,
  request,
  browser,
}, testInfo) => {
  const roomId = await createRoom(page);
  const url = new URL(page.url()).pathname;

  // 방장이 참여를 잠그면 새 사람은 들어올 수 없다.
  await page.getByRole("button", { name: "참여 잠그기" }).click();
  await expect(page.getByRole("button", { name: "잠금 풀기" })).toBeVisible();
  const guest = await newFriend(browser, testInfo);
  await guest.page.goto(url);
  await expect(guest.page.getByRole("heading", { name: "지금은 들어올 수 없는 방이에요" })).toBeVisible();
  await expect(guest.page.getByRole("heading", { name: "나도 출발역 넣기" })).toHaveCount(0);
  await shot(guest.page, "9-locked");
  // 잠겨도 방장은 자기 항목을 고칠 수 있다.
  await expect(page.getByRole("button", { name: "수정 내 항목" })).toBeVisible();

  // 잠금을 풀고 정원(4명)을 채우면 "가득 찼어요".
  await page.getByRole("button", { name: "잠금 풀기" }).click();
  await expect(page.getByRole("button", { name: "참여 잠그기" })).toBeVisible();
  await addParticipants(request, roomId, 3);
  await guest.page.reload();
  await expect(guest.page.getByRole("heading", { name: "방이 가득 찼어요" })).toBeVisible();
  await shot(guest.page, "10-full");
  await guest.context.close();

  // 방장이 한 명을 내보내면 자리가 생긴다.
  await page.reload();
  const hostPeople = page.getByRole("region", { name: "들어온 사람" });
  await expect(hostPeople.getByText("4/4명")).toBeVisible();
  await hostPeople
    .getByRole("button", { name: /내보내기/ })
    .first()
    .click();
  await page.getByRole("button", { name: "내보내기", exact: true }).click();
  await expect(hostPeople.getByText("3/4명")).toBeVisible();
  await page.getByRole("button", { name: "방 삭제 방 전체" }).click();
  await page.getByRole("button", { name: "방 지우기" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("없는 방·형식이 틀린 주소·만료 기록 정리", async ({ page }) => {
  await page.goto("/r/aaaaaaaaaa");
  await expect(page.getByRole("heading", { name: "찾을 수 없는 방이에요" })).toBeVisible();
  await shot(page, "11-not-found");

  // 형식이 틀린 주소는 서버에 묻지 않는다.
  const asked: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/v1/rooms")) asked.push(req.url());
  });
  await page.goto("/r/abc");
  await expect(page.getByRole("heading", { name: "찾을 수 없는 방이에요" })).toBeVisible();
  expect(asked).toEqual([]);

  // 만료된 방의 토큰은 사이트를 열 때 지워지고, 살아 있는 방의 기록과 다른 키는 그대로다.
  await page.evaluate(() => {
    const expired = { v: 1, participantToken: "x", expiresAt: "2020-01-01T00:00:00Z" };
    const alive = { v: 1, participantToken: "y", expiresAt: "2999-01-01T00:00:00Z" };
    window.localStorage.setItem("bby.room.bbbbbbbbbb", JSON.stringify(expired));
    window.localStorage.setItem("bby.room.cccccccccc", JSON.stringify(alive));
    window.localStorage.setItem("banbanyeok:me", JSON.stringify({ code: "03v", nickname: "" }));
  });
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("bby.room.bbbbbbbbbb"))).toBeNull();
  expect(await page.evaluate(() => window.localStorage.getItem("bby.room.cccccccccc"))).not.toBeNull();
  expect(await page.evaluate(() => window.localStorage.getItem("banbanyeok:me"))).not.toBeNull();
});

test("콜드스타트: 열리자마자 서버를 깨우고, 4초 늦어도 안내 문구가 단계적으로 바뀐다", async ({ page, request }) => {
  const created = await request.post("/api/v1/rooms", {
    data: { mode: "fair", host: { originCode: GANGNAM, hidden: false, nickname: "민수" } },
  });
  const { roomId } = (await created.json()) as { roomId: string };

  const order: string[] = [];
  await page.route("**/api/v1/rooms/**", async (route) => {
    if (route.request().method() === "GET" && route.request().url().endsWith(`/rooms/${roomId}`)) {
      order.push("room-request");
      await new Promise((done) => setTimeout(done, 4000)); // 콜드스타트 흉내
      order.push("room-response");
    }
    await route.continue();
  });
  page.on("request", (req) => {
    if (req.url().endsWith("/api/healthz")) order.push("healthz");
  });

  await page.goto(`/r/${roomId}`);
  // 로딩 중에도 설명이 먼저 읽히고, 2.5초가 지나면 서버를 깨우는 중이라고 알려 준다.
  await expect(page.getByRole("heading", { name: "함께 정하는 만날 역" })).toBeVisible();
  await expect(page.getByText("방을 불러오기 중이에요.")).toBeVisible();
  await expect(page.getByText(/서버를 깨우는 중이에요/)).toBeVisible({ timeout: 3500 });
  await shot(page, "12-loading-slow");
  await expect(page.getByRole("heading", { name: "나도 출발역 넣기" })).toBeVisible({ timeout: 8000 });
  expect(order.indexOf("healthz")).toBeGreaterThanOrEqual(0);
  expect(order.indexOf("healthz")).toBeLessThan(order.indexOf("room-response"));

  await request.delete(`/api/v1/rooms/${roomId}`).catch(() => undefined);
});
