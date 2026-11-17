import { afterEach, describe, expect, it, vi } from "vitest";
import type { RoomPreview } from "@/lib/api/types";

const loadRoomPreview = vi.fn<(roomId: string, signal: AbortSignal | undefined) => Promise<RoomPreview | null>>();
vi.mock("@/lib/seo/room-preview", () => ({
  loadRoomPreview: (roomId: string, signal?: AbortSignal) => loadRoomPreview(roomId, signal),
}));

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

afterEach(() => loadRoomPreview.mockReset());

describe("/r/[roomId]/og", () => {
  it("번호와 데이터 버전이 지금 값과 같으면 방 카드(PNG)를 하루 캐시로 준다", async () => {
    loadRoomPreview.mockResolvedValue(DECIDED);
    const response = await get("?sv=9&dv=20261115.8");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("public, max-age=86400, s-maxage=86400");
    expect(loadRoomPreview).toHaveBeenCalledWith(ROOM, expect.any(AbortSignal));
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
    let seen: AbortSignal | undefined;
    loadRoomPreview.mockImplementation((_id, signal) => {
      seen = signal;
      return new Promise(() => {});
    });
    const started = Date.now();
    const response = await get("?sv=9&dv=20261115.8");
    expect(Date.now() - started).toBeLessThan(3000);
    expect(seen?.aborted).toBe(true);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
  });
});
