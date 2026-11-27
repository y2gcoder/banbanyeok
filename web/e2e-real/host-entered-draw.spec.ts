import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import {
  type APIRequestContext,
  type Browser,
  devices,
  expect,
  type Locator,
  type Page,
  type TestInfo,
  test,
} from "@playwright/test";

/**
 * 혼자 입력한 결과에서 사다리 방 만들기(#227) e2e: 실제 서버(Ktor + DB)에서 추천 화면의 진입점 → 확인 대화상자 → 모두의 칸을 채운 잠긴
 * 뽑기 방 → 방장이 뽑기 → 다른 기기와 새로고침에서 같은 당첨자. 운은 서버가 정하므로 누가 뽑힐지는 모른다.
 */
const PHONE = { width: 390, height: 844 };
const ROOM_URL = /\/r\/([0-9a-hjkmnp-tv-z]{10})$/;
const DRAW_ROOMS = "/api/v1/draw-rooms";
const isCreate = (r: { url(): string; request(): { method(): string } }) =>
  r.url().endsWith(DRAW_ROOMS) && r.request().method() === "POST";

/**
 * 이 이름이 든 방의 수(개발 DB `scripts/dev.sh db`, 읽기만 한다). 다른 테스트가 같은 DB에 동시에 방을 만들므로 테스트마다 고유한 이름으로 센다.
 */
function roomsWith(nickname: string): number {
  if (!/^[가-힣0-9]+$/.test(nickname)) throw new Error(`이름: ${nickname}`);
  const sql = `select count(distinct room_id) from participants where nickname = '${nickname}'`;
  const out = execFileSync(
    "bash",
    ["scripts/dev.sh", "db", "exec", "-T", "db", "psql", "-U", "local", "-d", "banbanyeok", "-qtAc", sql],
    { cwd: resolve(import.meta.dirname, "../.."), encoding: "utf8" },
  );
  return Number(out.trim());
}

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64url");
/** 첫 사람(기본 '나')의 이름만 [first]로 바꾼 세 사람 결과. */
const resultWith = (first: string) =>
  `/result?v=2&o=k3a.ryf.1qs&m=f&t=saturday-evening&n=${b64(first)}..${b64("하늘")}`;
const uniqueName = () => `민수${Math.floor(1000 + Math.random() * 9000)}`;
const RESULT = `/result?v=2&o=k3a.ryf.1qs&m=f&t=saturday-evening&n=${b64("민수")}..${b64("하늘")}`;
/** 두 사람(민수, 하늘). 한 사람이 더 들어와도 정원(4명)이 차지 않아 잠금만 남는다. */
const RESULT_TWO = `/result?v=2&o=k3a.1qs&m=f&t=saturday-evening&n=${b64("민수")}.${b64("하늘")}`;

type ApiRoom = {
  locked: boolean;
  mode: string;
  meetingDate?: string | null;
  meetingBand?: string | null;
  favorTarget: string | null;
  participants: {
    participantId: string;
    label: string;
    shortLabel: string;
    isHost?: boolean;
    enteredByHost?: boolean;
  }[];
  favorDraw: { round: number; candidates: string[]; winner: string | null } | null;
};

/**
 * #225의 첫 화면 기준: 사다리 카드는 추천 위에 있고, 1위 역 이름·사람별 줄이 스크롤 없이 보인다. 정하기 버튼은 참여한 사람에게만 있다
 * (보기만 하는 사람에게는 없다).
 */
async function expectDrawAboveFirstScreenResult(page: Page, drawCard: Locator, member: boolean) {
  await expect(drawCard).toBeInViewport();
  const cardBox = await drawCard.boundingBox();
  const resultTitle = await page.getByRole("heading", { name: "만날 역 후보" }).boundingBox();
  expect((cardBox?.y ?? 0) + (cardBox?.height ?? 0)).toBeLessThanOrEqual(resultTitle?.y ?? 0);
  const top = page.locator("article[aria-labelledby='cand-1']");
  await expect(top.getByRole("heading").first()).toBeInViewport({ ratio: 1 });
  const rows = top.locator("ul").first().locator(":scope > li");
  await expect(rows).toHaveCount(3);
  const lastRow = await rows.last().boundingBox();
  expect((lastRow?.y ?? 0) + (lastRow?.height ?? 0)).toBeLessThanOrEqual(PHONE.height);
  const decide = top.getByRole("button", { name: "이 역으로 정했어요" });
  if (member) {
    const box = await decide.boundingBox();
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(PHONE.height);
  } else {
    await expect(decide).toHaveCount(0);
  }
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
}

async function expectNoA11yViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

test.use({ viewport: PHONE });

test("혼자 입력한 결과 → 확인 → 채운 사다리 방 → 뽑기, 다른 기기와 새로고침에서 같은 사람", async ({
  page,
  browser,
  request,
}, testInfo) => {
  await page.goto(RESULT);
  await expect(page.getByRole("article").first()).toBeVisible({ timeout: 15000 });

  await page.getByRole("button", { name: /사다리로 정하고 보내기/ }).click();
  const dialog = page.getByRole("dialog", { name: "사다리로 누구 쪽일지 뽑을까요?" });
  await expect(dialog).toContainText("사다리는 역이 아니라 사람을 뽑아요.");
  await expect(dialog).toContainText(
    "방 링크를 가진 사람은 누구나 이름, 출발역, 각자 걸리는 시간과 사다리 결과를 볼 수 있어요. 메신저에 뜨는 링크 미리보기에는 이름·출발역·시간을 넣지 않아요.",
  );
  await expectNoA11yViolations(page);
  await dialog.locator("label", { hasText: "하늘" }).click();
  await expect(dialog.getByRole("radio", { name: "하늘" })).toBeChecked();
  await dialog.getByRole("button", { name: "방 만들고 사다리 타러 가기" }).click();
  await expect(page).toHaveURL(ROOM_URL);
  const roomId = new URL(page.url()).pathname.split("/").pop() ?? "";

  const created = (await (await request.get(`/api/v1/rooms/${roomId}`)).json()) as ApiRoom;
  expect(created.participants.map((p) => [p.label, p.isHost === true, p.enteredByHost === true])).toEqual([
    ["민수", false, true],
    ["홍대입구에서 오는 분", false, true],
    ["하늘", true, false],
  ]);
  expect(created.locked).toBe(true);
  expect(created.mode).toBe("favor");
  expect(created.favorDraw?.round).toBe(0);
  expect(created.favorDraw?.candidates).toEqual(created.participants.map((p) => p.participantId));
  expect(created.meetingBand).toBe("evening");
  expect(new Date(`${created.meetingDate}T00:00:00Z`).getUTCDay()).toBe(6);

  const people = page.getByRole("region", { name: "들어온 사람" });
  await expect(people.getByText("방장이 입력")).toHaveCount(2);
  const pending = page.getByRole("heading", { name: "누구 쪽으로 뽑기 전" });
  await expect(pending).toBeVisible();
  await expectDrawAboveFirstScreenResult(page, page.getByRole("region", { name: "누구 쪽으로 뽑기 전" }), true);
  await expectNoA11yViolations(page);

  await page.getByRole("button", { name: "사다리 타기" }).first().click();
  await page.getByRole("button", { name: "건너뛰고 결과 보기" }).click();
  const drawn = (await (await request.get(`/api/v1/rooms/${roomId}`)).json()) as ApiRoom;
  expect(drawn.favorDraw?.round).toBe(1);
  expect(drawn.favorTarget).toBe(drawn.favorDraw?.winner);
  const winnerName = drawn.participants.find((p) => p.participantId === drawn.favorDraw?.winner)?.shortLabel ?? "";
  await expect(page.getByRole("heading", { name: `${winnerName} 쪽으로!` })).toBeVisible();

  const friend = await browser.newContext({
    ...devices["Pixel 7"],
    viewport: PHONE,
    locale: "ko-KR",
    baseURL: testInfo.project.use.baseURL ?? "http://127.0.0.1:3000",
  });
  const other = await friend.newPage();
  await other.goto(`/r/${roomId}`);
  await expect(other.getByRole("heading", { name: `${winnerName} 쪽으로!` })).toBeVisible({ timeout: 8000 });
  const friendCard = other.getByRole("region", { name: `${winnerName} 쪽으로!` });
  await expect(friendCard.getByRole("button", { name: "사다리 결과 보기", exact: true })).toBeInViewport({ ratio: 1 });
  await expectDrawAboveFirstScreenResult(other, friendCard, false);
  await expect(other.getByRole("heading", { name: "하늘이 모두의 출발역을 넣었어요" })).toBeVisible();
  await expect(other.getByRole("heading", { name: "나도 출발역 넣기" })).toHaveCount(0);
  await expect(other.getByRole("button", { name: "사다리 타기" })).toHaveCount(0);
  await expectNoA11yViolations(other);
  await friend.close();

  await page.reload();
  await expect(page.getByRole("heading", { name: `${winnerName} 쪽으로!` })).toBeVisible();
  const again = (await (await request.get(`/api/v1/rooms/${roomId}`)).json()) as ApiRoom;
  expect(again.favorDraw?.winner).toBe(drawn.favorDraw?.winner);
});

const KAKAO_UA = "facebookexternalhit/1.1; kakaotalk-scrap/1.0; +https://devtalk.kakao.com/t/scrap/33984";
const decode = (text: string) =>
  text
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/** 메신저 크롤러처럼 지금 공유 번호의 방 링크를 읽어 미리보기(제목·설명·그림)와 그 그림, 공용 미리보기 응답을 받는다. */
async function messengerPreview(request: APIRequestContext, roomId: string, testInfo: TestInfo, name: string) {
  const { shareVersion } = (await (await request.get(`/api/v1/rooms/${roomId}`)).json()) as { shareVersion: number };
  const html = await (
    await request.get(`/r/${roomId}?sv=${shareVersion}`, { headers: { "user-agent": KAKAO_UA } })
  ).text();
  const meta = (property: string) =>
    decode(html.match(new RegExp(`<meta property="${property}" content="([^"]*)"`))?.[1] ?? "");
  const image = new URL(meta("og:image"));
  const png = await request.get(image.pathname + image.search);
  expect(png.status()).toBe(200);
  expect(png.headers()["content-type"]).toBe("image/png");
  writeFileSync(testInfo.outputPath(`og-${name}.png`), await png.body());
  const api = await (await request.get(`/api/v1/rooms/${roomId}/preview`)).text();
  return { title: meta("og:title"), description: meta("og:description"), image, api };
}

test("방장이 대신 넣은 방의 링크 미리보기와 공유 칸 안내는 뽑기 전·뒤·정한 뒤 모두 이름·출발역·시간이 없다(방 화면은 그대로)", async ({
  page,
  request,
}, testInfo) => {
  const me = uniqueName();
  const roomId = await createFilledRoom(page, resultWith(me));
  const stored = (await (await request.get(`/api/v1/rooms/${roomId}`)).json()) as {
    participants: { nickname: string | null; originName: string | null }[];
  };
  const personal = stored.participants.flatMap((p) => [p.nickname, p.originName]).filter((v) => v !== null);
  expect(personal).toEqual(expect.arrayContaining([me, "하늘", "강남", "홍대입구"]));
  const people = page.getByRole("region", { name: "들어온 사람" });
  for (const text of [me, "하늘", "홍대입구"]) await expect(people).toContainText(text);

  const before = await messengerPreview(request, roomId, testInfo, "host-entered-before");
  expect([before.title, before.description]).toEqual([
    "만날 역 후보가 나왔어요 | 반반역",
    "만날 역과 각자 시간은 방에서 확인해요",
  ]);
  expect(before.image.pathname).toBe(`/r/${roomId}/og`);
  const shareHint = page.getByRole("region", { name: "링크 다시 보내기" }).getByText(/카톡 미리보기/);
  await expect(shareHint).toHaveText(
    /이름, 출발역, 각자 시간과 1위 역·사다리 결과를 넣지 않고 방에서 확인하라고만 보여요/,
  );

  await page.getByRole("button", { name: "사다리 타기" }).first().click();
  await page.getByRole("button", { name: "건너뛰고 결과 보기" }).click();
  await expect(page.getByRole("heading", { name: / 쪽으로!$/ })).toBeVisible();
  const after = await messengerPreview(request, roomId, testInfo, "host-entered-drawn");
  expect([after.title, after.description]).toEqual([
    "사다리 결과가 나왔어요! 누구 쪽일까요? | 반반역",
    "사다리 결과는 방에서 확인해요",
  ]);
  expect(after.image.searchParams.get("sv")).not.toBe(before.image.searchParams.get("sv"));
  await expect(shareHint).toHaveText(/이름, 출발역, 각자 시간과 1위 역·사다리 결과를 넣지 않고/);

  await page.getByRole("button", { name: "이 역으로 정했어요" }).first().click();
  const banner = page.getByRole("region", { name: /에서 만나요$/ });
  await expect(banner).toBeVisible();
  const decided = await messengerPreview(request, roomId, testInfo, "host-entered-decided");
  const station = (JSON.parse(decided.api) as { station: { stationName: string } }).station.stationName;
  await expect(banner).toHaveAccessibleName(`${station}에서 만나요`);
  expect(decided.title).toBe(`${station}에서 만나요 | 반반역`);
  expect(decided.description).toMatch(/^\d+월 \d+일 \([일월화수목금토]\) [가-힣]+ · 각자 시간은 방에서 확인해요$/);
  await expect(shareHint).toHaveText(/정한 역과 약속만 보이고 이름, 출발역, 각자 시간은 넣지 않아요/);

  for (const shown of [before, after, decided]) {
    const text = [shown.title, shown.description, shown.api].join(" ");
    for (const value of personal) expect(text, value).not.toContain(value);
    expect(shown.title + shown.description).not.toMatch(/\d+분/);
    const api = JSON.parse(shown.api) as {
      room: { enteredByHost?: boolean };
      station: { times: { seconds: unknown }[] };
    };
    expect(api.room.enteredByHost).toBe(true);
    expect(api.station.times.map((t) => t.seconds)).toEqual([null, null, null]);
  }
  await page.reload();
  for (const text of [me, "하늘", "홍대입구"]) await expect(people).toContainText(text);
});

/** 혼자 입력한 결과에서 대화상자로 채운 방을 만든다(하늘이 방장). 만든 방 ID를 돌려준다. */
async function createFilledRoom(page: Page, result: string): Promise<string> {
  await page.goto(result);
  await expect(page.getByRole("article").first()).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: /사다리로 정하고 보내기/ }).click();
  const dialog = page.getByRole("dialog", { name: "사다리로 누구 쪽일지 뽑을까요?" });
  await dialog.locator("label", { hasText: "하늘" }).click();
  await dialog.getByRole("button", { name: "방 만들고 사다리 타러 가기" }).click();
  await expect(page).toHaveURL(ROOM_URL);
  return new URL(page.url()).pathname.split("/").pop() ?? "";
}

async function newPerson(browser: Browser, testInfo: TestInfo) {
  const context = await browser.newContext({
    ...devices["Pixel 7"],
    viewport: PHONE,
    locale: "ko-KR",
    baseURL: testInfo.project.use.baseURL ?? "http://127.0.0.1:3000",
  });
  return { context, page: await context.newPage() };
}

test("채운 방의 잠금을 풀어 직접 들어온 사람이 생긴 뒤 다시 잠그면, 모두를 방장이 넣었다고 안내하지 않는다", async ({
  page,
  browser,
}, testInfo) => {
  const roomId = await createFilledRoom(page, RESULT_TWO);
  await page.getByRole("button", { name: "잠금 풀기" }).click();
  await expect(page.getByRole("button", { name: "참여 잠그기" })).toBeVisible();

  const joiner = await newPerson(browser, testInfo);
  await joiner.page.goto(`/r/${roomId}`);
  const form = joiner.page.getByRole("form", { name: "나도 출발역 넣기" });
  await form.getByRole("textbox", { name: /이름 \(선택\)/ }).fill("지연");
  await form.getByRole("combobox", { name: "내 출발역" }).fill("신촌");
  await joiner.page.getByRole("option", { name: /^신촌\s?2호선/ }).click();
  await joiner.page.getByRole("button", { name: "참여하기" }).click();
  await expect(joiner.page.getByRole("heading", { name: "나도 출발역 넣기" })).toHaveCount(0);
  await joiner.context.close();

  await page.reload();
  await page.getByRole("button", { name: "참여 잠그기" }).click();
  await expect(page.getByRole("button", { name: "잠금 풀기" })).toBeVisible();
  const people = page.getByRole("region", { name: "들어온 사람" });
  await expect(people.getByText("3/4명")).toBeVisible();
  await expect(people.getByText("방장이 입력")).toHaveCount(1);

  const visitor = await newPerson(browser, testInfo);
  await visitor.page.goto(`/r/${roomId}`);
  await expect(visitor.page.getByRole("heading", { name: "지금은 들어올 수 없는 방이에요" })).toBeVisible();
  await expect(visitor.page.getByRole("heading", { name: /모두의 출발역을 넣었어요/ })).toHaveCount(0);
  await expect(visitor.page.getByRole("region", { name: "들어온 사람" }).getByText("방장이 입력")).toHaveCount(1);
  await visitor.context.close();
});

test("방장 권한을 이 기기에 저장하지 못하면 방으로 가지 않고, 받은 방장 토큰으로 만든 방을 지운다", async ({
  page,
  request,
}) => {
  // 짧은 검사 값은 저장되지만 실제 방 기록은 저장 공간이 모자라 실패하는 브라우저.
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key.startsWith("bby.room.") && key !== "bby.room.probe") {
        throw new DOMException("quota", "QuotaExceededError");
      }
      original.call(this, key, value);
    };
  });
  let creates = 0;
  page.on("request", (r) => {
    if (r.url().endsWith(DRAW_ROOMS) && r.method() === "POST") creates += 1;
  });
  // 첫 삭제는 서버가 잠시 못 받는다(503). 삭제가 확인되기 전에는 지웠다고 하지 않고 토큰과 복구 상태를 지켜야 한다.
  let deletes = 0;
  await page.route("**/api/v1/rooms/*", async (route) => {
    if (route.request().method() !== "DELETE" || deletes++ > 0) return route.fallback();
    await route.fulfill({
      status: 503,
      contentType: "application/problem+json",
      body: JSON.stringify({
        type: "about:blank",
        title: "잠시 뒤",
        status: 503,
        detail: "잠시 뒤",
        code: "UNAVAILABLE",
      }),
    });
  });
  const me = uniqueName();
  const created = page.waitForResponse(isCreate);
  await page.goto(resultWith(me));
  await expect(page.getByRole("article").first()).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: /사다리로 정하고 보내기/ }).click();
  const dialog = page.getByRole("dialog", { name: "사다리로 누구 쪽일지 뽑을까요?" });
  await dialog.getByRole("button", { name: "방 만들고 사다리 타러 가기" }).click();
  const { roomId } = (await (await created).json()) as { roomId: string };

  await expect(dialog.getByRole("alert")).toContainText("이 브라우저에 방장 권한을 저장하지 못했어요");
  expect(new URL(page.url()).pathname).toBe("/result");
  expect((await request.get(`/api/v1/rooms/${roomId}`)).status()).toBe(200);
  expect(roomsWith(me)).toBe(1);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expectNoA11yViolations(page);

  await dialog.getByRole("button", { name: "만든 방 지우기" }).click();
  await expect(dialog.getByRole("alert")).toContainText("방을 지우지 못했어요.");
  await expect(dialog.getByText(/만든 방을 지웠어요/)).toHaveCount(0);
  expect((await request.get(`/api/v1/rooms/${roomId}`)).status()).toBe(200);
  await expect(dialog.getByRole("button", { name: "방 만들고 사다리 타러 가기" })).toHaveCount(0);

  await dialog.getByRole("button", { name: "만든 방 지우기" }).click();
  await expect(dialog.getByText("만든 방을 지웠어요. 저장 공간을 비운 뒤 다시 만들 수 있어요.")).toBeVisible();
  expect((await request.get(`/api/v1/rooms/${roomId}`)).status()).toBe(404);
  expect(deletes).toBe(2);
  expect(creates).toBe(1);
  expect(roomsWith(me)).toBe(0);
  await dialog.getByRole("button", { name: "취소" }).click();
  await expect(dialog).toHaveCount(0);
});

test("만든 응답을 받자마자 방장 권한을 저장해, 방 화면이 뜨기 전에 탭을 닫아도 다시 열면 방장이다", async ({
  page,
  context,
}) => {
  // 방 화면의 방 조회를 붙잡아 둔다(응답하지 않음). 만든 뒤 저장보다 앞서 조회·확인을 기다리면 여기서 멈춰 권한을 잃는다.
  await page.route("**/api/v1/rooms/*", (route) =>
    route.request().method() === "GET" ? new Promise<void>(() => undefined) : route.fallback(),
  );
  const me = uniqueName();
  const created = page.waitForResponse(isCreate);
  await page.goto(resultWith(me));
  await expect(page.getByRole("article").first()).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: /사다리로 정하고 보내기/ }).click();
  const dialog = page.getByRole("dialog", { name: "사다리로 누구 쪽일지 뽑을까요?" });
  await dialog.getByRole("button", { name: "방 만들고 사다리 타러 가기" }).click();
  const { roomId } = (await (await created).json()) as { roomId: string };
  await expect
    .poll(() => page.evaluate((key) => window.localStorage.getItem(key) !== null, `bby.room.${roomId}`), {
      timeout: 3000,
    })
    .toBe(true);
  await page.close();

  const reopened = await context.newPage();
  await reopened.goto(`/r/${roomId}`);
  await expect(reopened.getByRole("heading", { name: "내가 만든 방" })).toBeVisible({ timeout: 8000 });
  await expect(reopened.getByRole("button", { name: "사다리 타기" }).first()).toBeVisible();
  await expect(reopened.getByRole("button", { name: "방 삭제 방 전체" })).toBeVisible();
  expect(roomsWith(me)).toBe(1);
});

/** 채운 방 경로를 모르는 서버. `OLD_SERVER_ORIGIN`(main으로 빌드한 서버)이 있으면 그리로, 없으면 지금 서버의 없는 경로로 보낸다(같은 404). */
const OLD_SERVER_ORIGIN = process.env.OLD_SERVER_ORIGIN;

test("채운 방 경로를 모르는 옛 서버는 아무것도 저장하지 않고 거절하고, 웹은 지울 것 없이 만들 수 없다고만 알린다", async ({
  page,
}) => {
  await page.route(`**${DRAW_ROOMS}`, async (route) => {
    const url = OLD_SERVER_ORIGIN ? `${OLD_SERVER_ORIGIN}/v1/draw-rooms` : `${route.request().url()}-unknown`;
    await route.fulfill({ response: await route.fetch({ url }) });
  });
  let deletes = 0;
  page.on("request", (r) => {
    if (r.method() === "DELETE") deletes += 1;
  });
  const me = uniqueName();
  const created = page.waitForResponse(isCreate);
  await page.goto(resultWith(me));
  await expect(page.getByRole("article").first()).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: /사다리로 정하고 보내기/ }).click();
  const dialog = page.getByRole("dialog", { name: "사다리로 누구 쪽일지 뽑을까요?" });
  await dialog.getByRole("button", { name: "방 만들고 사다리 타러 가기" }).click();
  expect((await created).status()).toBe(404);

  await expect(dialog.getByRole("alert")).toContainText("지금은 사다리 방을 만들 수 없어요. 방은 만들지 않았어요.");
  expect(new URL(page.url()).pathname).toBe("/result");
  expect(roomsWith(me)).toBe(0);
  expect(deletes).toBe(0);
  expect(await page.evaluate(() => Object.keys(window.localStorage).filter((k) => k.startsWith("bby.room.")))).toEqual(
    [],
  );
});

/** 같은 DB를 쓰는 두 번째 서버 인스턴스(재생 캐시가 비어 있음). 있으면 다시 누른 요청을 그리로 보낸다. */
const SECOND_SERVER_ORIGIN = process.env.SECOND_SERVER_ORIGIN;

test("서버가 만든 뒤 응답을 잃고 탭을 닫아도, 다시 열어 같은 입력으로 누르면 그 방의 방장이 된다(방은 하나)", async ({
  page,
  context,
}) => {
  const me = uniqueName();
  let lostRoomId = "";
  await page.route(`**${DRAW_ROOMS}`, async (route) => {
    const response = await route.fetch();
    lostRoomId = ((await response.json()) as { roomId: string }).roomId;
    await route.abort("connectionreset");
  });
  await page.goto(resultWith(me));
  await expect(page.getByRole("article").first()).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: /사다리로 정하고 보내기/ }).click();
  const dialog = page.getByRole("dialog", { name: "사다리로 누구 쪽일지 뽑을까요?" });
  await dialog.getByRole("button", { name: "방 만들고 사다리 타러 가기" }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  expect(lostRoomId).toMatch(/^[0-9a-hjkmnp-tv-z]{10}$/);
  expect(roomsWith(me)).toBe(1);
  expect(await page.evaluate((id) => window.localStorage.getItem(`bby.room.${id}`), lostRoomId)).toBeNull();
  await page.close();

  const reopened = await context.newPage();
  if (SECOND_SERVER_ORIGIN) {
    await reopened.route(`**${DRAW_ROOMS}`, async (route) => {
      await route.fulfill({ response: await route.fetch({ url: `${SECOND_SERVER_ORIGIN}/v1/draw-rooms` }) });
    });
  }
  await reopened.goto(resultWith(me));
  await expect(reopened.getByRole("article").first()).toBeVisible({ timeout: 15000 });
  await reopened.getByRole("button", { name: /사다리로 정하고 보내기/ }).click();
  await reopened.getByRole("button", { name: "방 만들고 사다리 타러 가기" }).click();
  await expect(reopened).toHaveURL(new RegExp(`/r/${lostRoomId}$`));
  await expect(reopened.getByRole("heading", { name: "내가 만든 방" })).toBeVisible({ timeout: 8000 });
  await expect(reopened.getByRole("button", { name: "사다리 타기" }).first()).toBeVisible();
  expect(roomsWith(me)).toBe(1);
  expect(await reopened.evaluate(() => window.localStorage.getItem("bby.draw-room.attempt"))).toBeNull();
});

/** 같은 입력으로 연 탭에서 확인창을 열어 둔다(누르기 전). [second]면 그 탭의 만들기 요청을 두 번째 인스턴스로 보낸다. */
async function openDialogTab(page: Page, me: string, second: boolean) {
  if (second && SECOND_SERVER_ORIGIN) {
    await page.route(`**${DRAW_ROOMS}`, async (route) => {
      await route.fulfill({ response: await route.fetch({ url: `${SECOND_SERVER_ORIGIN}/v1/draw-rooms` }) });
    });
  }
  await page.goto(resultWith(me));
  await expect(page.getByRole("article").first()).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: /사다리로 정하고 보내기/ }).click();
  return page.getByRole("button", { name: "방 만들고 사다리 타러 가기" });
}

/** 다시 연 방 화면에서 방장 권한으로 실제로 바꿀 수 있는지(잠금 풀기 → 서버가 받아들임). */
async function expectWorkingHost(page: Page, roomId: string) {
  await page.goto(`/r/${roomId}`);
  await expect(page.getByRole("heading", { name: "내가 만든 방" })).toBeVisible({ timeout: 8000 });
  const unlocked = page.waitForResponse(
    (r) => r.url().endsWith(`/api/v1/rooms/${roomId}`) && r.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "잠금 풀기" }).click();
  expect((await unlocked).status()).toBe(200);
  await expect(page.getByRole("button", { name: "참여 잠그기" })).toBeVisible();
}

test("두 탭이 같은 입력으로 동시에 처음 만들어도 방은 하나이고, 남은 기록으로 방장 일을 할 수 있다", async ({
  context,
}) => {
  const me = uniqueName();
  const [a, b] = [await context.newPage(), await context.newPage()];
  // A의 요청은 B의 요청이 나간 뒤에 서버로 보낸다. 두 요청이 함께 서버에 있다(두 번째 인스턴스가 있으면 서로 다른 인스턴스).
  let bSent: () => void = () => undefined;
  const bInFlight = new Promise<void>((resolve) => (bSent = resolve));
  b.on("request", (r) => {
    if (r.url().endsWith(DRAW_ROOMS)) bSent();
  });
  await a.route(`**${DRAW_ROOMS}`, async (route) => {
    await bInFlight;
    await route.fallback();
  });
  const createA = await openDialogTab(a, me, false);
  const createB = await openDialogTab(b, me, true);
  await createA.click();
  await createB.click();
  await expect(a).toHaveURL(ROOM_URL);
  await expect(b).toHaveURL(ROOM_URL);
  expect(a.url()).toBe(b.url());
  expect(roomsWith(me)).toBe(1);
  await expectWorkingHost(await context.newPage(), roomIdOf(a.url()));
});

test("응답을 잃은 방을 두 탭이 함께 되찾고 응답이 늦게 온 쪽이 나중에 저장해도, 남은 기록으로 방장 일을 할 수 있다", async ({
  context,
}) => {
  const me = uniqueName();
  const lost = await context.newPage();
  let roomId = "";
  await lost.route(`**${DRAW_ROOMS}`, async (route) => {
    roomId = ((await (await route.fetch()).json()) as { roomId: string }).roomId;
    await route.abort("connectionreset");
  });
  await (await openDialogTab(lost, me, false)).click();
  await expect(lost.getByRole("dialog").getByRole("alert")).toBeVisible();
  await lost.close();

  const [slow, fast] = [await context.newPage(), await context.newPage()];
  // 늦은 탭의 응답은 빠른 탭이 방에 들어가 기록을 저장한 뒤에 전달한다(응답 순서가 뒤바뀜).
  let fastSaved: () => void = () => undefined;
  const fastDone = new Promise<void>((resolve) => (fastSaved = resolve));
  await slow.route(`**${DRAW_ROOMS}`, async (route) => {
    const response = await route.fetch();
    await fastDone;
    await route.fulfill({ response });
  });
  const createSlow = await openDialogTab(slow, me, false);
  const createFast = await openDialogTab(fast, me, true);
  await createSlow.click();
  await createFast.click();
  await expect(fast).toHaveURL(new RegExp(`/r/${roomId}$`));
  fastSaved();
  await expect(slow).toHaveURL(new RegExp(`/r/${roomId}$`));
  expect(roomsWith(me)).toBe(1);
  await expectWorkingHost(await context.newPage(), roomId);
});

const roomIdOf = (url: string) => new URL(url).pathname.split("/").pop() ?? "";
