import AxeBuilder from "@axe-core/playwright";
import { type Browser, devices, expect, type Locator, type Page, type TestInfo, test } from "@playwright/test";

/**
 * 혼자 입력한 결과에서 사다리 방 만들기(#227) e2e: 실제 서버(Ktor + DB)에서 추천 화면의 진입점 → 확인 대화상자 → 모두의 칸을 채운 잠긴
 * 뽑기 방 → 방장이 뽑기 → 다른 기기와 새로고침에서 같은 당첨자. 운은 서버가 정하므로 누가 뽑힐지는 모른다.
 */
const PHONE = { width: 390, height: 844 };
const ROOM_URL = /\/r\/([0-9a-hjkmnp-tv-z]{10})$/;
const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64url");
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
    "방 링크를 가진 사람은 누구나 이름, 출발역, 각자 걸리는 시간과 사다리 결과를 볼 수 있어요.",
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
  const created = page.waitForResponse((r) => r.url().endsWith("/api/v1/rooms") && r.request().method() === "POST");
  await page.goto(RESULT);
  await expect(page.getByRole("article").first()).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: /사다리로 정하고 보내기/ }).click();
  const dialog = page.getByRole("dialog", { name: "사다리로 누구 쪽일지 뽑을까요?" });
  await dialog.getByRole("button", { name: "방 만들고 사다리 타러 가기" }).click();
  const { roomId } = (await (await created).json()) as { roomId: string };

  await expect(dialog.getByRole("alert")).toContainText("이 브라우저에 방장 권한을 저장하지 못했어요");
  expect(new URL(page.url()).pathname).toBe("/result");
  expect((await request.get(`/api/v1/rooms/${roomId}`)).status()).toBe(200);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expectNoA11yViolations(page);

  await dialog.getByRole("button", { name: "만든 방 지우기" }).click();
  await expect(dialog.getByText("만든 방을 지웠어요. 저장 공간을 비운 뒤 다시 만들 수 있어요.")).toBeVisible();
  expect((await request.get(`/api/v1/rooms/${roomId}`)).status()).toBe(404);
  await dialog.getByRole("button", { name: "취소" }).click();
  await expect(dialog).toHaveCount(0);
});

test("대신 넣은 칸을 모르는 옛 서버(others를 버림)가 방장만 있는 열린 방을 만들면, 웹이 그 방을 지우고 방으로 가지 않는다", async ({
  page,
  request,
}) => {
  // 옛 서버는 모르는 필드를 무시한다. 같은 상황을 만들려고 요청 본문에서 others·hostPosition을 빼고 실제 서버로 보낸다.
  await page.route("**/api/v1/rooms", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const { others: _others, hostPosition: _position, ...body } = route.request().postDataJSON();
    await route.fallback({ postData: JSON.stringify(body) });
  });
  const created = page.waitForResponse((r) => r.url().endsWith("/api/v1/rooms") && r.request().method() === "POST");
  await page.goto(RESULT);
  await expect(page.getByRole("article").first()).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: /사다리로 정하고 보내기/ }).click();
  const dialog = page.getByRole("dialog", { name: "사다리로 누구 쪽일지 뽑을까요?" });
  await dialog.getByRole("button", { name: "방 만들고 사다리 타러 가기" }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  const { roomId } = (await response.json()) as { roomId: string };

  await expect(dialog.getByRole("alert")).toContainText("지금은 사다리 방을 만들 수 없어요. 만들던 방은 지웠어요.");
  expect(new URL(page.url()).pathname).toBe("/result");
  expect((await request.get(`/api/v1/rooms/${roomId}`)).status()).toBe(404);
});
