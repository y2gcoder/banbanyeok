import type { Page } from "@playwright/test";

/**
 * 방 화면 배치 점검용 가짜 방 API. 가짜 서버(mock/)는 방을 구현하지 않으므로(r1-notes 10-4) 같은 출처 `/api/v1/rooms**` 요청을
 * 브라우저에서 가로채 정해 둔 응답을 준다. 방 흐름 자체(숨김·토큰·멱등)는 e2e-real/rooms.spec.ts가 실제 서버로 검증한다.
 * 여기서는 화면 상태별 **배치**만 본다: 방장 혼자 / 친구가 참여 전 / 방장이 3명과 결과를 보는 화면.
 */
export const FAKE_ROOM_ID = "qt7yvmsht3";
const HOST_TOKEN = "htok-layout-host";
const HOST_PARTICIPANT_TOKEN = "ptok-layout-host";

export type RoomScenario = "host-alone" | "friend-join" | "host-full";

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

/** 시나리오의 방을 가로채 준비한다. 방장 시나리오는 이 기기에 방장 기록(토큰)을 넣어 둔다. 열 주소를 돌려준다. */
export async function prepareRoom(page: Page, scenario: RoomScenario): Promise<string> {
  const people = scenario === "host-alone" ? [HOST] : [HOST, HIDDEN_FRIEND, NAMED_FRIEND];
  const asHost = scenario !== "friend-join";
  if (asHost) {
    const record = {
      v: 1,
      hostToken: HOST_TOKEN,
      participantToken: HOST_PARTICIPANT_TOKEN,
      participantId: "h1",
      keepUntil: "2999-01-01T00:00:00.000Z",
    };
    await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [
      `bby.room.${FAKE_ROOM_ID}`,
      JSON.stringify(record),
    ] as const);
  }
  await page.route("**/api/v1/rooms/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    const self = request.headers().authorization === `Bearer ${HOST_PARTICIPANT_TOKEN}`;
    const participants = people.map((p) => ({ ...p, isSelf: self && p.participantId === "h1" }));
    if (request.method() === "GET" && path === `/rooms/${FAKE_ROOM_ID}`) {
      return route.fulfill(
        json(200, {
          roomId: FAKE_ROOM_ID,
          mode: "fair",
          locked: false,
          expiresAt: "2999-01-01T00:00:00Z",
          dataVersion: "20261114.5",
          participants,
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
          candidates: CANDIDATES,
        }),
      );
    }
    return route.fulfill(json(404, { code: "ROOM_NOT_FOUND", message: "없는 방이에요" }));
  });
  return `/r/${FAKE_ROOM_ID}`;
}
