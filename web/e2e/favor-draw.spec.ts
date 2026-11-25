import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { horizontalOverflow } from "./support/layout";

/**
 * '누구 쪽으로' 뽑기(#172) 화면. 가짜 서버(mock/)는 방을 구현하지 않으므로 같은 출처 `/api/v1/rooms**`를 가로채 뽑기 방을 흉내 낸다
 * (운은 서버가 정한다: 여기서는 지영이 뽑힌다). 실제 서버로 하는 흐름은 e2e-real/favor-draw.spec.ts에 있다.
 * 방: 민수(방장), 참가자 2(출발역 숨김), 지영. 숨긴 사람은 뽑기에서 빠진다.
 */
const PHONE = { width: 390, height: 844 };
const ROOM_ID = "qt7yvmsht3";
const HOST_TOKEN = "htok-draw-host";
const HOST_PART = "ptok-draw-host";
const JIYOUNG_PART = "ptok-draw-jiyoung";
const HIDDEN_PART = "ptok-draw-hidden";

const BASIS = {
  timeSlot: "weekday-day",
  requestedTimeSlot: "weekday-day",
  dayType: "weekday",
  band: "day",
  label: "평일 낮",
  holidayName: null,
};

const PEOPLE = [
  {
    participantId: "h1",
    hidden: false,
    originCode: "k3a",
    originName: "강남",
    label: "민수",
    shortLabel: "민수",
    nickname: "민수",
    labelKind: "name",
    isHost: true,
  },
  {
    participantId: "f1",
    hidden: true,
    originCode: null,
    originName: null,
    label: "참가자 2",
    shortLabel: "참가자 2",
    nickname: null,
    labelKind: "ordinal",
    isHost: false,
  },
  {
    participantId: "f2",
    hidden: false,
    originCode: "1qs",
    originName: "신촌",
    label: "지영",
    shortLabel: "지영",
    nickname: "지영",
    labelKind: "name",
    isHost: false,
  },
];

const CANDIDATES = [
  { rank: 1, stationCode: "s1q", stationName: "동대문역사문화공원" },
  { rank: 2, stationCode: "v96", stationName: "신용산" },
].map((c) => ({
  ...c,
  times: PEOPLE.map((p, i) => ({ participantId: p.participantId, seconds: 1200 + i * 60, transfers: 0 })),
  maxSeconds: 1320,
  spreadSeconds: 120,
  totalSeconds: 3780,
  reasonCode: "FAIR_MINIMAX",
  reason: "가장 오래 걸리는 사람도 22분이에요.",
}));

/**
 * `candidates`는 뽑을 때의 대상(서버가 그대로 준다), `extra`는 방에 더 있는 사람. 대상 중 방에 없는 사람은 뽑은 뒤 나간 사람이다.
 */
type DrawState = {
  round: number;
  winner: string | null;
  candidates?: string[];
  extra?: typeof PEOPLE;
  /** 다음 뽑기 요청을 409 ROOM_CHANGED로 거절한다(그사이 방이 바뀜). */
  reject?: boolean;
};

/** 뽑기 방을 가로챈다. `state`를 바꾸면 다음 요청부터 그 상태다(다른 사람이 뽑은 것처럼). */
async function fakeDrawRoom(page: Page, state: DrawState, record?: Record<string, unknown>) {
  if (record) {
    // 다시 불러와도 덮어쓰지 않는다(이 기기가 저장한 '본 뽑기'가 남게).
    await page.addInitScript(
      ([key, value]) => window.localStorage.getItem(key) ?? window.localStorage.setItem(key, value),
      [`bby.room.${ROOM_ID}`, JSON.stringify({ v: 1, keepUntil: "2999-01-01T00:00:00.000Z", ...record })] as const,
    );
  }
  const room = (selfId: string | null) => ({
    roomId: ROOM_ID,
    mode: "favor",
    favorTarget: state.winner,
    locked: false,
    expiresAt: "2999-01-01T00:00:00Z",
    dataVersion: "20261114.5",
    meetingDate: null,
    meetingTime: null,
    timeBasis: BASIS,
    roomHash: "0123456789abcdef",
    shareVersion: 4 + state.round,
    decision: null,
    participants: [...PEOPLE, ...(state.extra ?? [])].map((p) => ({ ...p, isSelf: p.participantId === selfId })),
    favorDraw: {
      generation: 0,
      round: state.round,
      maxRounds: 2,
      candidates: state.candidates ?? ["h1", "f2"],
      winner: state.winner,
      drawnAt: state.winner ? "2026-11-25T11:14:00Z" : null,
      excluded: [{ participantId: "f1", reason: "hidden" }],
    },
  });
  await page.route("**/api/v1/rooms/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/v1", "");
    const auth = request.headers().authorization;
    const selfId =
      auth === `Bearer ${HOST_PART}`
        ? "h1"
        : auth === `Bearer ${JIYOUNG_PART}`
          ? "f2"
          : auth === `Bearer ${HIDDEN_PART}`
            ? "f1"
            : null;
    const ok = (body: unknown) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (request.method() === "POST" && path === `/rooms/${ROOM_ID}/favor-draw`) {
      expect(auth).toBe(`Bearer ${HOST_TOKEN}`);
      if (state.reject) {
        return route.fulfill({
          status: 409,
          contentType: "application/problem+json",
          body: JSON.stringify({
            type: "about:blank",
            title: "바뀜",
            status: 409,
            detail: "바뀜",
            code: "ROOM_CHANGED",
          }),
        });
      }
      expect(request.postDataJSON()).toEqual({ generation: 0, round: state.round + 1 });
      state.round += 1;
      state.winner = "f2";
      return ok(room(null));
    }
    if (request.method() === "GET" && path === `/rooms/${ROOM_ID}`) return ok(room(selfId));
    if (request.method() === "GET" && path === `/rooms/${ROOM_ID}/preview`) {
      // 미리보기 응답은 뽑은 뒤에도 결과를 그대로 준다(웹이 메신저 그림·글에서만 숨긴다).
      return ok({
        stage: "result",
        room: {
          roomId: ROOM_ID,
          shareVersion: 4 + state.round,
          participantCount: PEOPLE.length,
          canJoin: true,
          meetingDate: null,
          meetingTime: null,
          meetingBand: null,
          timeBasis: BASIS,
        },
        dataVersion: "20261114.5",
        basis: state.winner
          ? { mode: "favor", favorLabel: "지영", drawRound: state.round }
          : { mode: "fair", favorLabel: null },
        station: {
          stationCode: "s1q",
          stationName: "동대문역사문화공원",
          times: PEOPLE.map((p, i) => ({ label: p.shortLabel, seconds: 1200 + i * 60 })),
        },
      });
    }
    if (request.method() === "GET" && path === `/rooms/${ROOM_ID}/result`) {
      return ok({
        status: "ok",
        mode: url.searchParams.get("mode") ?? "fair",
        dataVersion: "20261114.5",
        participants: room(selfId).participants,
        baselineStationCode: "s1q",
        candidates: CANDIDATES,
        timeBasis: BASIS,
        shareVersion: 4 + state.round,
      });
    }
    return route.fulfill({
      status: 404,
      contentType: "application/problem+json",
      body: JSON.stringify({ type: "about:blank", title: "없음", status: 404, detail: "없음", code: "ROOM_NOT_FOUND" }),
    });
  });
  return `/r/${ROOM_ID}`;
}

async function expectNoA11yViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

async function expectTouchTarget(page: Page, name: string | RegExp) {
  const box = await page.getByRole("button", { name }).boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
}

const SEOJUN = {
  participantId: "f3",
  hidden: false,
  originCode: "ryf",
  originName: "홍대입구",
  label: "서준",
  shortLabel: "서준",
  nickname: "서준",
  labelKind: "name",
  isHost: false,
};

/** 사다리 모양(가로줄 좌표와 길의 꺾이는 점). 이름표와 색은 빼고 비교한다. */
const ladderShape = (page: Page) =>
  page
    .getByRole("img", { name: /사다리타기/ })
    .evaluate((svg) =>
      [...svg.querySelectorAll("line, polyline")].map((el) =>
        el.tagName === "line"
          ? ["x1", "x2", "y1", "y2"].map((a) => el.getAttribute(a)).join(",")
          : (el.getAttribute("points") ?? ""),
      ),
    );

/** 뽑기 결과 문장(aria-live). 카드가 바뀌어도 남도록 방 화면에 있다. */
const announced = (page: Page, text = "뽑기 결과, 오늘은 지영 쪽으로 맞춰요.") =>
  page.locator("[aria-live='polite']", { hasText: text });

const topCard = (page: Page) => page.locator("article[aria-labelledby='cand-1']");

/** 1위 카드의 정하기 버튼 아래끝이 폰 첫 화면 안에 있다(#168). */
async function expectTopCardOnFirstScreen(page: Page) {
  const name = "이 역으로 정했어요";
  const decide = topCard(page).getByRole("button", { name }).or(topCard(page).getByRole("link", { name }));
  const box = await decide.boundingBox();
  expect((box?.y ?? 9999) + (box?.height ?? 0)).toBeLessThanOrEqual(PHONE.height);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
}

const SEEN = { drawSeen: "0:1" };

test.describe("'누구 쪽으로' 뽑기", () => {
  test.use({ viewport: PHONE, isMobile: true, hasTouch: true });

  test("방장: 뽑기 전 한 줄 카드에서 사다리를 타면 결과 위에서 재생하고, 끝나면 접혀 1위가 첫 화면에 돌아온다", async ({
    page,
  }) => {
    const state: DrawState = { round: 0, winner: null };
    await page.goto(
      await fakeDrawRoom(page, state, {
        hostToken: HOST_TOKEN,
        participantToken: HOST_PART,
        participantId: "h1",
        expectedCount: 3,
      }),
    );
    await expect(page.getByRole("heading", { name: "누구 쪽으로 뽑기 전" })).toBeVisible();
    await expect(page.getByText("누구 쪽으로(뽑기 전)")).toBeVisible();
    await expect(page.getByRole("tab", { name: "공평하게" })).toHaveAttribute("aria-selected", "true");
    await expectTouchTarget(page, "사다리 타기");
    await expectTouchTarget(page, "뽑기 자세히 보기");
    await page.getByRole("button", { name: "뽑기 자세히 보기" }).click();
    await expect(page.getByText(/참가자 2는 출발역을 숨겨서/)).toBeVisible();
    await expectNoA11yViolations(page);
    expect(await horizontalOverflow(page)).toEqual([]);

    await page.getByRole("button", { name: "사다리 타기" }).first().click();
    const skip = page.getByRole("button", { name: "건너뛰고 결과 보기" });
    await expect(skip).toBeFocused();
    await expectTouchTarget(page, "건너뛰고 결과 보기");
    // 재생 중에는 그림 이름이 당첨자를 미리 말하지 않고, 결과 문장도 아직 없다.
    await expect(page.getByRole("img", { name: /사다리타기/ })).toHaveAccessibleName(
      "사다리타기: 민수, 지영 중 한 사람",
    );
    await expect(announced(page)).toHaveCount(0);
    await expectNoA11yViolations(page);
    // 끝나면 접힌 한 줄이 후보 아래로 가고, 초점은 결과 제목(1위 카드 바로 위)에, 결과 문장은 한 번.
    await expect(page.getByRole("heading", { name: "지영 쪽으로!" })).toBeVisible({ timeout: 6000 });
    await expect(page.getByRole("heading", { name: "만날 역 후보" })).toBeFocused();
    await expect(announced(page)).toHaveCount(1);
    await expect(page.getByRole("img", { name: /사다리타기/ })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "누구 쪽으로" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("button", { name: "지영", pressed: true })).toBeVisible();
    await expect(page.getByText("지영 쪽으로(뽑기)")).toBeVisible();
    await expectTopCardOnFirstScreen(page);
    // 공유 칸 안내도 실제 공유(결과를 숨긴 미리보기)와 같다.
    await expect(
      page.getByText(/카톡 미리보기에는 사다리 결과\(누구 쪽인지, 1위 역, 각자 시간\)를 숨기고 이름만 보여요/),
    ).toBeVisible();
    await expect(page.getByText(/카톡 미리보기에 지금 1위 역과 각자 시간이 보여요/)).toHaveCount(0);
    // 다시 뽑아 같은 사람이 또 나와도 두 번째 결과가 읽힌다(회차가 드러나는 문장).
    await page.getByRole("button", { name: "사다리 보기" }).click();
    await page.getByRole("button", { name: "다시 뽑기 (1번 남음)" }).click();
    await page.getByRole("button", { name: "다시 뽑기", exact: true }).click();
    await expect(page.getByRole("heading", { name: "뽑는 중…" })).toBeVisible();
    await expect(announced(page, "다시 뽑은 결과, 오늘은 지영 쪽으로 맞춰요.")).toHaveCount(1, { timeout: 6000 });
    await expect(page.getByRole("heading", { name: "지영 쪽으로!" })).toBeVisible();
    // 이 기기는 이번 뽑기를 봤다: 다시 열어도 재생하지 않는다.
    await page.reload();
    await expect(page.getByRole("heading", { name: "지영 쪽으로!" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "뽑는 중…" })).toHaveCount(0);
    await expectTopCardOnFirstScreen(page);
  });

  test("방장의 다시 뽑기: 확인·취소 사이 초점이 남고, 확정 뒤 서버가 거절하면 오류 안내로 초점이 간다", async ({
    page,
  }) => {
    const state: DrawState = { round: 1, winner: "f2", reject: true };
    await page.goto(
      await fakeDrawRoom(page, state, {
        hostToken: HOST_TOKEN,
        participantToken: HOST_PART,
        participantId: "h1",
        ...SEEN,
      }),
    );
    await page.getByRole("button", { name: "사다리 보기" }).click();
    await expectTouchTarget(page, "다시 보기");
    await page.getByRole("button", { name: "다시 뽑기 (1번 남음)" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "다시 뽑기", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "취소" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "다시 뽑기 (1번 남음)" })).toBeFocused();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    const alert = page.getByRole("alert").filter({ hasText: "그사이 방이 바뀌었어요" });
    await expect(alert).toBeFocused();
    await expectNoA11yViolations(page);
  });

  test("동작 줄이기: 뽑기를 누르면 재생 없이 곧바로 접힌 결과(펼치면 움직이지 않는 사다리)이고, 결과 문장을 한 번 읽는다", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const state: DrawState = { round: 0, winner: null };
    await page.goto(
      await fakeDrawRoom(page, state, { hostToken: HOST_TOKEN, participantToken: HOST_PART, participantId: "h1" }),
    );
    await page.getByRole("button", { name: "사다리 타기" }).click();
    await expect(page.getByRole("heading", { name: "지영 쪽으로!" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "뽑는 중…" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "만날 역 후보" })).toBeFocused();
    await expect(announced(page)).toHaveCount(1);
    await expectTopCardOnFirstScreen(page);
    await page.getByRole("button", { name: "사다리 보기" }).click();
    await expect(page.getByRole("img", { name: "사다리타기 결과: 지영 쪽으로" })).toBeVisible();
    await expect(page.getByRole("button", { name: "다시 보기" })).toHaveCount(0);
  });

  test("다른 참가자: 뽑기 전에는 방장을 기다리고, 처음 보는 결과는 한 번 저절로 재생한 뒤 접히며, 다시 열면 접힌 결과다", async ({
    page,
  }) => {
    const state: DrawState = { round: 0, winner: null };
    await page.goto(await fakeDrawRoom(page, state, { participantToken: JIYOUNG_PART, participantId: "f2" }));
    await expect(page.getByRole("button", { name: "사다리 타기" })).toHaveCount(0);
    await page.getByRole("button", { name: "뽑기 자세히 보기" }).click();
    await expect(page.getByText(/방장이 곧 뽑아요/)).toBeVisible();
    await expectNoA11yViolations(page);

    // 방장이 뽑았다.
    state.round = 1;
    state.winner = "f2";
    await page.reload();
    await expect(page.getByRole("heading", { name: "뽑는 중…" })).toBeVisible();
    // 스스로 누른 것이 아니라 초점은 옮기지 않는다.
    await expect(page.getByRole("button", { name: "건너뛰고 결과 보기" })).not.toBeFocused();
    await expect(page.getByRole("heading", { name: "지영 쪽으로!" })).toBeVisible({ timeout: 6000 });
    await expect(announced(page)).toHaveCount(1);
    await expect(page.getByRole("tab", { name: "누구 쪽으로" })).toHaveAttribute("aria-selected", "true");
    await expectTopCardOnFirstScreen(page);

    await page.reload();
    await expect(page.getByRole("heading", { name: "지영 쪽으로!" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "뽑는 중…" })).toHaveCount(0);
    await page.getByRole("button", { name: "사다리 보기" }).click();
    await expect(page.getByRole("img", { name: "사다리타기 결과: 지영 쪽으로" })).toBeVisible();
    await expect(page.getByRole("button", { name: /다시 뽑기/ })).toHaveCount(0);
    await expectNoA11yViolations(page);
  });

  test("뽑은 뒤 대상이 나가도 같은 사다리이고(나간 사람은 자리만), 다시 보기는 끝까지 재생된다", async ({ page }) => {
    const state: DrawState = { round: 1, winner: "f2", candidates: ["h1", "f2", "f3"], extra: [SEOJUN] };
    await page.goto(await fakeDrawRoom(page, state, { participantToken: JIYOUNG_PART, participantId: "f2", ...SEEN }));
    await page.getByRole("button", { name: "사다리 보기" }).click();
    const before = await ladderShape(page);
    // 서준이 나갔다: 서버는 뽑을 때의 자리를 그대로 두고 원래 ID 대신 자리 표시를 준다.
    state.extra = [];
    state.candidates = ["h1", "f2", "~2"];
    await page.reload();
    await page.getByRole("button", { name: "사다리 보기" }).click();
    await expect(page.getByText("나간 사람", { exact: true })).toBeVisible();
    expect(await ladderShape(page)).toEqual(before);
    await page.getByRole("button", { name: "다시 보기" }).click();
    await expect(page.getByRole("heading", { name: "뽑는 중…" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "지영 쪽으로!" })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("heading", { name: "지영 쪽으로!" })).toBeFocused();
  });

  test("출발역을 숨긴 본인: 펼치면 뽑기에서 빠졌다는 안내를 보고, 그림에는 본인 칸이 없다", async ({ page }) => {
    const state: DrawState = { round: 1, winner: "f2" };
    await page.goto(await fakeDrawRoom(page, state, { participantToken: HIDDEN_PART, participantId: "f1", ...SEEN }));
    await page.getByRole("button", { name: "사다리 보기" }).click();
    await expect(page.getByText(/참가자 2는 뽑을 때 출발역을 숨겨서/)).toBeVisible();
    await expect(page.getByText(/출발역을 숨긴 사람을 빼면, 다른 사람도/)).toBeVisible();
    const pills = page.getByRole("img", { name: /사다리타기/ }).locator("xpath=preceding-sibling::ol");
    await expect(pills).toHaveText(/민수.*지영/);
    await expect(pills.getByText("참가자 2")).toHaveCount(0);
  });
});
