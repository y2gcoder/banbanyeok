import type { Page } from "@playwright/test";

/**
 * 방 화면 배치 점검용 가짜 방 API. 가짜 서버(mock/)는 방을 구현하지 않으므로(r1-notes 10-4) 같은 출처 `/api/v1/rooms**` 요청을
 * 브라우저에서 가로채 정해 둔 응답을 준다. 방 흐름 자체(숨김·토큰·멱등)는 e2e-real/rooms.spec.ts가 실제 서버로 검증한다.
 * 여기서는 화면 상태별 **배치**만 본다: 방장 혼자 / 친구가 참여 전 / 방장이 3명과 결과를 보는 화면.
 */
export const FAKE_ROOM_ID = "qt7yvmsht3";
const HOST_TOKEN = "htok-layout-host";
const HOST_PARTICIPANT_TOKEN = "ptok-layout-host";
const HIDDEN_PARTICIPANT_TOKEN = "ptok-layout-hidden";

/**
 * `hidden-self`: 출발역을 숨긴 친구(참가자 2) 본인이 보는 화면. 본인에게만 본인의 출발역과 막차가 온다.
 * `friend-alone`: 방장 혼자인 방에 링크로 들어와 아직 참여 전인 화면(결과 전).
 */
export type RoomScenario = "host-alone" | "friend-join" | "host-full" | "hidden-self" | "friend-alone";

/** 열어 둔 방의 인원을 테스트 중에 바꾼다: `alone`이면 방장 한 명, 아니면 세 명. 다음 방 요청부터 적용된다. */
export type RoomCrowd = { alone: boolean };

/**
 * 막차 칸(#62)의 갈래를 보려고 약속과 숨김만 바꾼 방.
 * - `dawn`: 토요일 02:59 약속(금요일 운행일). 민수의 막차는 토요일 00:27이라 약속보다 먼저 떠난다.
 * - `undated`: 약속 날짜가 없는 방. 서버는 요일을 몰라 시각을 주지 않는다(`day_unknown`, 기본값 평일·partial은 그대로 온다).
 * - `all-hidden`: 모두 출발역을 숨긴 방. 본인이 아닌 사람에게는 막차 항목이 하나도 오지 않는다.
 */
export type RoomVariant = "default" | "dawn" | "undated" | "all-hidden";

/**
 * '누구 쪽으로' 뽑기 방(#172)으로 열기: `pending`은 아직 안 뽑음, `drawn`은 지연이와 함께 오는 아주 긴 이름(f2)이 뽑힘(이 기기는
 * 처음 봄: 한 번 재생), `drawn-seen`은 같은 뽑기를 이 기기에서 이미 봄(기록이 있는 시나리오만, 처음부터 접힌 결과).
 * 숨긴 참가자 2는 대상에서 빠진다. 없으면 공평하게 방이다.
 */
export type RoomDraw = "pending" | "drawn" | "drawn-seen";

const json = (status: number, body: unknown) => ({
  status,
  contentType: "application/json",
  body: JSON.stringify(body),
});

const HOST = {
  participantId: "h1",
  hidden: false,
  originCode: "k3a",
  originName: "강남",
  label: "민수",
  labelKind: "name",
  shortLabel: "민수",
  nickname: "민수",
  isHost: true,
};
const HIDDEN_FRIEND = {
  participantId: "f1",
  hidden: true,
  originCode: null,
  originName: null,
  label: "참가자 2",
  labelKind: "ordinal",
  shortLabel: "참가자 2",
  nickname: null,
  isHost: false,
};
const NAMED_FRIEND = {
  participantId: "f2",
  hidden: false,
  originCode: "1qs",
  originName: "신촌",
  label: "지연이와 함께 오는 아주 긴 이름",
  labelKind: "name",
  shortLabel: "지연이와 함께 오는 아주 긴 이름",
  nickname: "지연이와 함께 오는 아주 긴 이름",
  isHost: false,
};

/** 가짜 서버(mock)가 강남·홍대입구·신촌에 돌려주는 값을 방 결과 모양으로 옮긴 것. */
const CANDIDATES = [
  {
    rank: 1,
    stationCode: "s1q",
    stationName: "동대문역사문화공원",
    times: [
      { participantId: "h1", seconds: 1349, transfers: 0 },
      { participantId: "f1", seconds: 1287, transfers: 0 },
      { participantId: "f2", seconds: 1164, transfers: 0 },
    ],
    maxSeconds: 1349,
    spreadSeconds: 185,
    totalSeconds: 3800,
    reasonCode: "FAIR_MINIMAX",
    reason: "가장 오래 걸리는 민수도 22분이에요. 2위 신용산보다 가장 오래 걸리는 사람이 1분 덜 걸려요.",
  },
  {
    rank: 2,
    stationCode: "v96",
    stationName: "신용산",
    times: [
      { participantId: "h1", seconds: 1388, transfers: 1 },
      { participantId: "f1", seconds: 1172, transfers: 1 },
      { participantId: "f2", seconds: 1049, transfers: 1 },
    ],
    maxSeconds: 1388,
    spreadSeconds: 339,
    totalSeconds: 3609,
    reasonCode: "FAIR_ALTERNATIVE",
    reason: "공평 모드 대안이에요. 1위 동대문역사문화공원보다 가장 오래 걸리는 사람이 1분 더 걸려요.",
  },
  {
    rank: 3,
    stationCode: "xnc",
    stationName: "이촌",
    times: [
      { participantId: "h1", seconds: 1388, transfers: 1 },
      { participantId: "f1", seconds: 1172, transfers: 1 },
      { participantId: "f2", seconds: 1049, transfers: 1 },
    ],
    maxSeconds: 1388,
    spreadSeconds: 339,
    totalSeconds: 3609,
    reasonCode: "FAIR_ALTERNATIVE",
    reason: "공평 모드 대안이에요. 1위 동대문역사문화공원보다 가장 오래 걸리는 사람이 1분 더 걸려요.",
  },
];

/**
 * 집에 가는 막차(#62). 약속일이 토요일이라 일부 노선만 계산한 요일 종류다(`partial`). 민수는 직행 확정, 긴 이름의 친구는 확인 필요,
 * 출발역을 숨긴 참가자 2는 본인에게만 온다(갈아타는 여유 시각 22:47 → 화면 22:40).
 */
const LAST_TRAIN_BASIS = { dayType: "saturday", asOf: "2026-11-16", partial: true };

function lastTrains(selfId: string | null, variant: RoomVariant = "default") {
  if (variant === "all-hidden") return [];
  if (variant === "undated") {
    return [
      { participantId: "h1", kind: "check" },
      ...(selfId === "f1" ? [{ participantId: "f1", kind: "check" }] : []),
      { participantId: "f2", kind: "check" },
    ];
  }
  return [
    {
      participantId: "h1",
      kind: "direct",
      // 금요일 운행일의 24:27은 토요일 00:27이다(새벽 약속 02:59보다 먼저).
      minute: variant === "dawn" ? 1467 : 1432,
      boundFor: { stationCode: "bvq", stationName: "성수" },
    },
    ...(selfId === "f1" ? [{ participantId: "f1", kind: "margin", minute: 1367, transfer: true }] : []),
    { participantId: "f2", kind: "check" },
  ];
}

const WEEKDAY_NIGHT_BASIS = {
  timeSlot: "weekday-night",
  requestedTimeSlot: "weekday-night",
  dayType: "weekday",
  band: "night",
  label: "평일 밤",
  holidayName: null,
};

/** 갈래별 약속과 계산 기준. 기본은 2026-11-21(토) 19:30이다. */
function meetingOf(variant: RoomVariant) {
  if (variant === "dawn") {
    return {
      meetingDate: "2026-11-28",
      meetingTime: "02:59",
      timeBasis: WEEKDAY_NIGHT_BASIS,
      lastTrainBasis: { dayType: "weekday", asOf: "2026-11-16", partial: true },
    };
  }
  if (variant === "undated") {
    return {
      meetingDate: null,
      meetingTime: null,
      timeBasis: {
        ...WEEKDAY_NIGHT_BASIS,
        timeSlot: "weekday-day",
        requestedTimeSlot: "weekday-day",
        band: "day",
        label: "평일 낮",
      },
      lastTrainBasis: { dayType: "weekday", asOf: "2026-11-16", partial: true, unavailable: "day_unknown" },
    };
  }
  return { meetingDate: "2026-11-21", meetingTime: "19:30", timeBasis: ROOM_BASIS, lastTrainBasis: LAST_TRAIN_BASIS };
}

/** 서버가 약속 날짜·시각(2026-11-21 19:30)에서 정해 주는 계산 기준. 웹은 이 label을 그대로 쓴다. */
export const ROOM_BASIS = {
  timeSlot: "saturday-evening",
  requestedTimeSlot: "saturday-evening",
  dayType: "saturday",
  band: "evening",
  label: "토요일 저녁",
  holidayName: null,
};

/** 방 응답의 `roomHash`(계약 형식: 16자리 소문자 hex). */
export const FAKE_ROOM_HASH = "0123456789abcdef";

/**
 * 시나리오의 방을 가로채 준비한다. 방장 시나리오는 이 기기에 방장 기록(토큰)을 넣어 둔다. 열 주소를 돌려준다.
 * `shareVersion`을 주면 방이 공유 번호·방 해시를 싣고 링크 미리보기(`/preview`, 결과 단계)도 답한다(공유 칸이 번호 붙은 링크를 쓴다).
 * `crowd`를 넘기면 테스트 중에 `crowd.alone`을 바꿔 다음 방 요청부터 인원이 바뀐다(두 번째 사람이 들어오는 순간).
 */
export async function prepareRoom(
  page: Page,
  scenario: RoomScenario,
  shareVersion?: number,
  variant: RoomVariant = "default",
  crowd: RoomCrowd = { alone: scenario === "host-alone" || scenario === "friend-alone" },
  draw?: RoomDraw,
): Promise<string> {
  const peopleNow = () => {
    const listed = crowd.alone ? [HOST] : [HOST, HIDDEN_FRIEND, NAMED_FRIEND];
    return variant === "all-hidden"
      ? listed.map((p, i) => ({
          ...p,
          hidden: true,
          originCode: null,
          originName: null,
          label: p.nickname ?? `참가자 ${i + 1}`,
          shortLabel: p.nickname ?? `참가자 ${i + 1}`,
        }))
      : listed;
  };
  const meeting = meetingOf(variant);
  const asHost = scenario === "host-alone" || scenario === "host-full";
  if (asHost || scenario === "hidden-self") {
    const record = asHost
      ? {
          v: 1,
          hostToken: HOST_TOKEN,
          participantToken: HOST_PARTICIPANT_TOKEN,
          participantId: "h1",
          keepUntil: "2999-01-01T00:00:00.000Z",
          ...(draw === "drawn-seen" ? { drawSeen: "0:1" } : {}),
        }
      : {
          v: 1,
          participantToken: HIDDEN_PARTICIPANT_TOKEN,
          participantId: "f1",
          keepUntil: "2999-01-01T00:00:00.000Z",
          ...(draw === "drawn-seen" ? { drawSeen: "0:1" } : {}),
        };
    await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [
      `bby.room.${FAKE_ROOM_ID}`,
      JSON.stringify(record),
    ] as const);
  }
  await page.route("**/api/v1/rooms/**", async (route) => {
    const people = peopleNow();
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    const authorization = request.headers().authorization;
    const selfId =
      authorization === `Bearer ${HOST_PARTICIPANT_TOKEN}`
        ? "h1"
        : authorization === `Bearer ${HIDDEN_PARTICIPANT_TOKEN}`
          ? "f1"
          : null;
    // 출발역을 숨긴 사람 본인에게는 서버가 본인의 출발역을 준다(다른 사람에게는 null).
    const participants = people.map((p) => ({
      ...p,
      ...(p.participantId === "f1" && selfId === "f1" ? { originCode: "ep4", originName: "합정" } : {}),
      isSelf: p.participantId === selfId,
    }));
    if (request.method() === "GET" && path === `/rooms/${FAKE_ROOM_ID}`) {
      return route.fulfill(
        json(200, {
          roomId: FAKE_ROOM_ID,
          mode: draw ? "favor" : "fair",
          ...(draw
            ? {
                favorTarget: draw !== "pending" ? "f2" : null,
                favorDraw: {
                  generation: 0,
                  round: draw !== "pending" ? 1 : 0,
                  maxRounds: 2,
                  candidates: ["h1", "f2"],
                  winner: draw !== "pending" ? "f2" : null,
                  drawnAt: draw !== "pending" ? "2026-11-21T10:14:00Z" : null,
                  excluded: [{ participantId: "f1", reason: "hidden" }],
                },
              }
            : {}),
          locked: false,
          expiresAt: "2999-01-01T00:00:00Z",
          dataVersion: "20261114.5",
          meetingDate: meeting.meetingDate,
          meetingTime: meeting.meetingTime,
          timeBasis: meeting.timeBasis,
          participants,
          ...(shareVersion === undefined ? {} : { shareVersion, roomHash: FAKE_ROOM_HASH, decision: null }),
        }),
      );
    }
    if (request.method() === "GET" && path === `/rooms/${FAKE_ROOM_ID}/preview` && shareVersion !== undefined) {
      const top = CANDIDATES[0];
      return route.fulfill(
        json(200, {
          stage: "result",
          room: {
            roomId: FAKE_ROOM_ID,
            shareVersion,
            participantCount: people.length,
            canJoin: people.length < 4,
            meetingDate: meeting.meetingDate,
            meetingTime: meeting.meetingTime,
            meetingBand: null,
            timeBasis: meeting.timeBasis,
          },
          dataVersion: "20261114.5",
          basis: { mode: "fair", favorLabel: null },
          station: {
            stationCode: top?.stationCode,
            stationName: top?.stationName,
            // 미리보기는 누가 묻든 같다: 숨긴 사람의 막차는 없다.
            times: people.map((p, i) => {
              const lastTrain = lastTrains(null, variant).find((t) => t.participantId === p.participantId);
              const { participantId: _id, ...entry } = lastTrain ?? { participantId: "" };
              return {
                label: p.shortLabel,
                seconds: top?.times[i]?.seconds ?? null,
                ...(lastTrain ? { lastTrain: entry } : {}),
              };
            }),
          },
          lastTrainBasis: meeting.lastTrainBasis,
        }),
      );
    }
    if (request.method() === "GET" && path === `/rooms/${FAKE_ROOM_ID}/result`) {
      return route.fulfill(
        json(200, {
          status: "ok",
          mode: "fair",
          dataVersion: "20261114.5",
          participants,
          baselineStationCode: "s1q",
          candidates: CANDIDATES.map((c) => ({ ...c, lastTrains: lastTrains(selfId, variant) })),
          timeBasis: meeting.timeBasis,
          lastTrainBasis: meeting.lastTrainBasis,
        }),
      );
    }
    return route.fulfill({
      status: 404,
      contentType: "application/problem+json",
      body: JSON.stringify({
        type: "https://banbanyeok.app/problems/room-not-found",
        title: "방을 찾을 수 없음",
        status: 404,
        detail: "없는 방이에요",
        code: "ROOM_NOT_FOUND",
      }),
    });
  });
  return `/r/${FAKE_ROOM_ID}`;
}
