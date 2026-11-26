import { afterEach, describe, expect, it, vi } from "vitest";
import type { RoomPreview } from "@/lib/api/types";

const loadRoomPreview = vi.fn<(roomId: string, signal: AbortSignal | undefined) => Promise<RoomPreview | null>>();
vi.mock("@/lib/seo/room-preview", () => ({
  loadRoomPreview: (roomId: string, signal?: AbortSignal) => loadRoomPreview(roomId, signal),
}));

/** 그린 방 카드의 반반지수 값(#202). 호출부가 숨김 가드를 거친 값을 넘기는지 본다. */
const drawn: unknown[] = [];
vi.mock("@/components/og/shared-card", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/components/og/shared-card")>();
  return {
    ...original,
    SharedCard: (props: Parameters<typeof original.SharedCard>[0]) => {
      drawn.push(props.data.banban ?? null);
      return original.SharedCard(props);
    },
  };
});

const { GET } = await import("./route");

const ROOM = "qt7yvmsht3";
const DECIDED: RoomPreview = {
  stage: "decided",
  room: {
    roomId: ROOM,
    shareVersion: 9,
    participantCount: 3,
    canJoin: false,
    meetingDate: "2026-11-21",
    meetingTime: "19:30",
    meetingBand: "evening",
    timeBasis: {
      timeSlot: "saturday-evening",
      requestedTimeSlot: "saturday-evening",
      dayType: "saturday",
      band: "evening",
      label: "토요일 저녁",
      holidayName: null,
    },
  },
  dataVersion: "20261115.8",
  basis: { mode: "fair", favorLabel: null },
  station: {
    stationCode: "s1q",
    stationName: "동대문역사문화공원",
    times: [
      { label: "민수", seconds: 1349 },
      { label: "참가자 2", seconds: 1287 },
      { label: "지연🎂", seconds: null },
    ],
  },
  decidedBy: "참가자 2",
  decidedAt: "2026-11-17T10:00:00Z",
};

const get = (search: string, roomId = ROOM) =>
  GET(new Request(`https://banbanyeok.app/r/${roomId}/og${search}`), { params: Promise.resolve({ roomId }) });

afterEach(() => {
  vi.useRealTimers();
  loadRoomPreview.mockReset();
  drawn.length = 0;
});

describe("/r/[roomId]/og", () => {
  it("번호와 데이터 버전이 지금 값과 같으면 방 카드(PNG)를 하루 캐시로 준다", async () => {
    loadRoomPreview.mockResolvedValue(DECIDED);
    const response = await get("?sv=9&dv=20261115.8");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("public, max-age=86400, s-maxage=86400");
    expect(loadRoomPreview).toHaveBeenCalledWith(ROOM, expect.any(AbortSignal));
  });

  it("막차 표를 아직 읽는 중(lastTrainPending)이면 방 카드를 짧게만 캐시한다(막차 줄이 붙은 카드로 곧 바뀐다)", async () => {
    const { room, dataVersion, basis, station } = DECIDED as Extract<RoomPreview, { stage: "decided" }>;
    const pending: RoomPreview[] = [
      { ...DECIDED, lastTrainPending: true },
      { stage: "result", room, dataVersion, basis, station, lastTrainPending: true },
    ];
    for (const preview of pending) {
      loadRoomPreview.mockResolvedValue(preview);
      const response = await get("?sv=9&dv=20261115.8");
      expect(response.headers.get("content-type"), preview.stage).toBe("image/png");
      expect(response.headers.get("cache-control"), preview.stage).toBe("public, max-age=60, s-maxage=60");
    }
  });

  it("그림 버전(iv)은 캐시를 비켜 가는 값일 뿐이다: 있든 없든, 옛 값이든 지금 방 카드를 준다", async () => {
    loadRoomPreview.mockResolvedValue(DECIDED);
    // 배포 전에 열어 둔 화면은 옛 iv(또는 iv 없는) 주소로 공유한다. 그 메시지도 기본 그림이 아니라 방 카드를 받는다.
    for (const search of ["?sv=9&dv=20261115.8&iv=0a1b2c3d", "?sv=9&dv=20261115.8&iv=", "?sv=9&dv=20261115.8"]) {
      const response = await get(search);
      expect(response.headers.get("cache-control"), search).toBe("public, max-age=86400, s-maxage=86400");
    }
  });

  it("번호나 데이터 버전이 지금과 다르면 그 주소에 방 카드를 남기지 않고 기본 그림(짧은 캐시)", async () => {
    loadRoomPreview.mockResolvedValue(DECIDED);
    for (const search of ["?sv=8&dv=20261115.8", "?sv=10&dv=20261115.8", "?sv=9&dv=20261114.1"]) {
      const response = await get(search);
      expect(response.headers.get("content-type"), search).toBe("image/png");
      expect(response.headers.get("cache-control"), search).toBe("public, max-age=60");
    }
  });

  it("모으는 중·서버 실패도 기본 그림이고, 잘못된 주소는 서버를 부르지 않는다", async () => {
    loadRoomPreview.mockResolvedValue({ stage: "collecting", room: DECIDED.room });
    expect((await get("?sv=9&dv=20261115.8")).headers.get("cache-control")).toBe("public, max-age=60");
    loadRoomPreview.mockResolvedValue(null);
    expect((await get("?sv=9&dv=20261115.8")).headers.get("cache-control")).toBe("public, max-age=60");
    loadRoomPreview.mockClear();
    for (const [search, roomId] of [
      ["", ROOM],
      ["?sv=9", ROOM],
      ["?sv=x&dv=1", ROOM],
      ["?sv=9&dv=1", "../../etc"],
    ] as const) {
      const response = await get(search, roomId);
      expect(response.status, search).toBe(200);
      expect(response.headers.get("cache-control"), search).toBe("public, max-age=60");
    }
    expect(loadRoomPreview).not.toHaveBeenCalled();
  });

  it("서버가 예산(1.5초) 안에 답하지 않으면 호출을 끊고 기본 그림을 준다(500 없음)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let seen: AbortSignal | undefined;
    loadRoomPreview.mockImplementation((_id, signal) => {
      seen = signal;
      return new Promise(() => {});
    });
    const pending = get("?sv=9&dv=20261115.8");
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toBeDefined();
    await vi.advanceTimersByTimeAsync(1499);
    expect(seen?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(seen?.aborted).toBe(true);
    const response = await pending;
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
  });

  it("반반지수(#202): 숨긴 사람이 있을 수 있는 방(300초 배수 시간)이면 빼고, 없으면(21·22분) 막대와 한 줄을 그린다", async () => {
    const { room, dataVersion, station } = DECIDED as Extract<RoomPreview, { stage: "decided" }>;
    const resultOf = (seconds: number[]): RoomPreview => ({
      stage: "result",
      room,
      dataVersion,
      basis: { mode: "fair", favorLabel: null },
      station: { ...station, times: seconds.map((s, index) => ({ label: `참가자 ${index + 1}`, seconds: s })) },
    });
    // 숨긴 참가자의 시간은 남에게 300초의 배수로 간다(20분). 본인 화면은 정확한 시간이라 같은 방에서 말이 갈린다.
    loadRoomPreview.mockResolvedValue(resultOf([20 * 60, 21 * 60 + 10]));
    expect((await get("?sv=9&dv=20261115.8")).status).toBe(200);
    expect(drawn).toEqual([null]);
    drawn.length = 0;
    loadRoomPreview.mockResolvedValue(resultOf([21 * 60 + 10, 22 * 60 + 10]));
    expect((await get("?sv=9&dv=20261115.8")).status).toBe(200);
    expect(drawn).toEqual([{ kind: "close", text: "걸리는 시간이 두 사람 1분 차이예요" }]);
  });
});
