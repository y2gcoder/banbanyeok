import { afterEach, describe, expect, it, vi } from "vitest";
import type { RoomPreview } from "@/lib/api/types";

const getRoom = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/rooms", () => ({ getRoom }));

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

const DAY = "public, max-age=86400, s-maxage=86400";
const MINUTE = "public, max-age=60, s-maxage=60";

const get = (search: string, roomId = ROOM) =>
  GET(new Request(`https://banbanyeok.app/r/${roomId}/og${search}`), { params: Promise.resolve({ roomId }) });

afterEach(() => {
  vi.useRealTimers();
  loadRoomPreview.mockReset();
  getRoom.mockReset();
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

  it.each([
    {
      label: "공개 0초",
      seconds: [0, 981],
      hidden: false,
      version: 9,
      lookup: false,
      text: "가장 오래 걸리는 사람도 16분이에요",
      cache: DAY,
    },
    {
      label: "공개 양의 배수",
      seconds: [1200, 1261],
      hidden: false,
      version: 9,
      lookup: true,
      text: "걸리는 시간이 두 사람 1분 차이예요",
      cache: DAY,
    },
    {
      label: "1시간 넘는 공개 방",
      seconds: [3000, 5640],
      hidden: false,
      version: 9,
      lookup: true,
      text: "가장 오래 걸리는 사람 1시간 34분",
      cache: DAY,
    },
    { label: "옛 숨김 방", seconds: [1200, 1261], hidden: true, version: 9, lookup: true, text: null, cache: DAY },
    { label: "다른 버전", seconds: [1200, 1261], hidden: false, version: 10, lookup: true, text: null, cache: MINUTE },
    {
      label: "조회 실패",
      seconds: [1200, 1261],
      hidden: false,
      version: null,
      lookup: true,
      text: null,
      cache: MINUTE,
    },
  ])("$label 방 그림", async ({ seconds, hidden, version, lookup, text, cache }) => {
    const { room, dataVersion, station } = DECIDED as Extract<RoomPreview, { stage: "decided" }>;
    loadRoomPreview.mockResolvedValue({
      stage: "result",
      room: { ...room, participantCount: 2 },
      dataVersion,
      basis: { mode: "fair", favorLabel: null },
      station: { ...station, times: seconds.map((s, index) => ({ label: `참가자 ${index + 1}`, seconds: s })) },
    });
    if (version === null) getRoom.mockRejectedValue(new Error("offline"));
    else getRoom.mockResolvedValue({ shareVersion: version, participants: [{ hidden }, { hidden: false }] });
    const response = await get("?sv=9&dv=20261115.8");
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe(cache);
    expect(drawn).toEqual([text ? expect.objectContaining({ text }) : null]);
    if (lookup) expect(getRoom).toHaveBeenCalledWith(ROOM, null, { signal: expect.any(AbortSignal) });
    else expect(getRoom).not.toHaveBeenCalled();
  });

  it.each([0, 1200])(
    "미리보기가 %ims 걸리면 남은 예산 안에서만 공개 여부를 조회하고 방 카드를 그린다",
    async (previewMs) => {
      const { room, dataVersion, station } = DECIDED as Extract<RoomPreview, { stage: "decided" }>;
      const preview: RoomPreview = {
        stage: "result",
        room: { ...room, participantCount: 2 },
        dataVersion,
        basis: { mode: "fair", favorLabel: null },
        station: { ...station, times: [1200, 1261].map((s, i) => ({ label: `참가자 ${i + 1}`, seconds: s })) },
      };
      let lookup: AbortSignal | undefined;
      getRoom.mockImplementation(
        (_id: string, _token: null, { signal }: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            lookup = signal;
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          }),
      );
      vi.useFakeTimers({ toFake: ["performance"] });
      loadRoomPreview.mockImplementation(async () => {
        vi.advanceTimersByTime(previewMs);
        return preview;
      });
      const response = await get("?sv=9&dv=20261115.8");
      if (previewMs === 0) expect(lookup?.aborted).toBe(true);
      else expect(getRoom).not.toHaveBeenCalled();
      expect(response.headers.get("content-type")).toBe("image/png");
      expect(response.headers.get("cache-control")).toBe(MINUTE);
      expect(drawn).toEqual([null]);
    },
  );
});
