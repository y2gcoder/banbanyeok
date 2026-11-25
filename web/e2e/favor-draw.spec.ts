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

type DrawState = { round: number; winner: string | null };

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
    participants: PEOPLE.map((p) => ({ ...p, isSelf: p.participantId === selfId })),
    favorDraw: {
      generation: 0,
      round: state.round,
      maxRounds: 2,
      candidates: ["h1", "f2"],
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
      expect(request.postDataJSON()).toEqual({ generation: 0, round: state.round + 1 });
      state.round += 1;
      state.winner = "f2";
      return ok(room(null));
    }
    if (request.method() === "GET" && path === `/rooms/${ROOM_ID}`) return ok(room(selfId));
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

const drawCard = (page: Page) => page.getByRole("region", { name: /누구 쪽으로|뽑는 중|쪽으로!/ });

async function expectNoA11yViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

async function expectTouchTarget(page: Page, name: string | RegExp) {
  const box = await page.getByRole("button", { name }).boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
}

test.describe("'누구 쪽으로' 뽑기", () => {
  test.use({ viewport: PHONE, isMobile: true, hasTouch: true });

  test("방장: 뽑기 전에는 공평하게, 사다리를 타면 결과가 저장된 지영 쪽으로 바뀐다(숨긴 사람은 빠짐)", async ({
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
    await expect(page.getByRole("heading", { name: "누구 쪽으로 할지 뽑아요" })).toBeVisible();
    await expect(page.getByText("누구 쪽으로(뽑기) · 아직 안 뽑았어요")).toBeVisible();
    await expect(page.getByRole("tab", { name: "공평하게" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText(/참가자 2는 출발역을 숨겨서 뽑기에서 빠졌어요/)).toBeVisible();
    await expectTouchTarget(page, "사다리 타기");
    await expectNoA11yViolations(page);
    expect(await horizontalOverflow(page)).toEqual([]);

    await page.getByRole("button", { name: "사다리 타기" }).click();
    const skip = page.getByRole("button", { name: "건너뛰고 결과 보기" });
    await expect(skip).toBeFocused();
    await expectTouchTarget(page, "건너뛰고 결과 보기");
    // 그림의 칸은 숨기지 않은 두 사람뿐이다.
    const ladder = page.getByRole("img", { name: /사다리타기/ });
    await expect(ladder).toHaveAccessibleName("사다리타기 결과: 지영 쪽으로");
    const result = page.getByRole("heading", { name: "지영 쪽으로!" });
    await expect(result).toBeVisible({ timeout: 6000 });
    await expect(result).toBeFocused();
    await expect(
      page.locator("[aria-live='polite']", { hasText: "뽑기 결과, 오늘은 지영 쪽으로 맞춰요." }),
    ).toHaveCount(1);
    await expect(page.getByRole("tab", { name: "누구 쪽으로" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("button", { name: "지영", pressed: true })).toBeVisible();
    await expect(page.getByText("지영 쪽으로(뽑기)")).toBeVisible();
    await expectTouchTarget(page, "다시 뽑기 (1번 남음)");
    await expectTouchTarget(page, "다시 보기");
    await expectNoA11yViolations(page);
  });

  test("동작 줄이기: 뽑기를 누르면 그림 없이 곧바로 결과", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const state: DrawState = { round: 0, winner: null };
    await page.goto(
      await fakeDrawRoom(page, state, { hostToken: HOST_TOKEN, participantToken: HOST_PART, participantId: "h1" }),
    );
    await page.getByRole("button", { name: "사다리 타기" }).click();
    await expect(page.getByRole("heading", { name: "지영 쪽으로!" })).toBeVisible();
    await expect(page.getByRole("button", { name: "건너뛰고 결과 보기" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "다시 보기" })).toHaveCount(0);
  });

  test("다른 참가자: 뽑기 전에는 방장을 기다리고, 뽑힌 결과는 처음 볼 때 한 번 재생한 뒤 접어 둔다", async ({
    page,
  }) => {
    const state: DrawState = { round: 0, winner: null };
    await page.goto(await fakeDrawRoom(page, state, { participantToken: JIYOUNG_PART, participantId: "f2" }));
    await expect(page.getByText(/방장이 곧 뽑아요/)).toBeVisible();
    await expect(page.getByRole("button", { name: "사다리 타기" })).toHaveCount(0);
    await expectNoA11yViolations(page);

    // 방장이 뽑았다.
    state.round = 1;
    state.winner = "f2";
    await page.reload();
    await expect(page.getByRole("button", { name: "건너뛰고 결과 보기" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "지영 쪽으로!" })).toBeVisible({ timeout: 6000 });
    await expect(page.getByRole("button", { name: /다시 뽑기/ })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "누구 쪽으로" })).toHaveAttribute("aria-selected", "true");

    // 이 기기는 이번 뽑기를 봤다: 다시 열면 그림 없이 결과만(1위 카드가 첫 화면 가까이, #168).
    await page.reload();
    await expect(page.getByRole("heading", { name: "지영 쪽으로!" })).toBeVisible();
    await expect(page.getByRole("img", { name: /사다리타기/ })).toHaveCount(0);
    await expect(drawCard(page).getByText(/방장이 뽑았어요/)).toBeVisible();
  });

  test("출발역을 숨긴 본인: 뽑기에서 빠졌다는 안내를 보고, 그림에는 본인 칸이 없다", async ({ page }) => {
    const state: DrawState = { round: 1, winner: "f2" };
    await page.goto(await fakeDrawRoom(page, state, { participantToken: HIDDEN_PART, participantId: "f1" }));
    await expect(page.getByText(/참가자 2는 출발역을 숨겨서 뽑기에서 빠졌어요/)).toBeVisible();
    const ladder = page.getByRole("img", { name: /사다리타기/ });
    await expect(ladder).toBeVisible();
    const card = drawCard(page);
    await expect(card.getByText("민수", { exact: true })).toBeVisible();
    await expect(card.getByText("지영", { exact: true }).first()).toBeVisible();
    await expect(card.locator("ol").first().getByText("참가자 2")).toHaveCount(0);
  });
});
