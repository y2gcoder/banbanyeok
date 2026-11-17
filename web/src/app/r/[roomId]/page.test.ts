import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/lib/api/client";
import type { RoomPreview } from "@/lib/api/types";
import { roomLinkMetadata } from "@/lib/seo/metadata";

const getRoomPreview = vi.fn<(roomId: string) => Promise<RoomPreview>>();
vi.mock("@/lib/api/rooms", () => ({ getRoomPreview: (roomId: string) => getRoomPreview(roomId) }));

const { generateMetadata } = await import("./page");

const ROOM = "qt7yvmsht3";
const BASIS = {
  timeSlot: "weekday-day",
  requestedTimeSlot: "weekday-day",
  dayType: "weekday",
  band: "day",
  label: "평일 낮",
  holidayName: null,
} as const;
const ROOM_PART = {
  roomId: ROOM,
  shareVersion: 6,
  participantCount: 2,
  canJoin: true,
  meetingDate: "2026-11-21",
  meetingTime: null,
  meetingBand: "evening",
  timeBasis: BASIS,
} as const;
const STATION = {
  stationCode: "s1q",
  stationName: "신촌",
  times: [
    { label: "민수", seconds: 1349 },
    { label: "참가자 2", seconds: 1164 },
  ],
};
const RESULT: RoomPreview = {
  stage: "result",
  room: ROOM_PART,
  dataVersion: "20261115.8",
  basis: { mode: "fair", favorLabel: null },
  station: STATION,
};
const DECIDED: RoomPreview = {
  ...RESULT,
  stage: "decided",
  decidedBy: "민수",
  decidedAt: "2026-11-17T10:00:00Z",
};

const meta = (roomId: string, search: Record<string, string | string[]>) =>
  generateMetadata({ params: Promise.resolve({ roomId }), searchParams: Promise.resolve(search) });
const og = (m: Awaited<ReturnType<typeof meta>>) => m.openGraph as Record<string, unknown>;

afterEach(() => getRoomPreview.mockReset());

describe("방 링크 미리보기(/r/[roomId])", () => {
  it("공유 번호가 없거나 잘못됐으면 서버를 부르지 않는 얇은 일반 문구다", async () => {
    for (const search of [{}, { sv: "abc" }, { sv: "-1" }, { sv: "012" }, { sv: "1e3" }, { sv: ["1", "2"] }]) {
      expect(await meta(ROOM, search)).toEqual(roomLinkMetadata());
    }
    expect(await meta("not-a-room", { sv: "3" })).toEqual(roomLinkMetadata());
    expect(getRoomPreview).not.toHaveBeenCalled();
  });

  it("번호가 지금 이하면 지금 단계의 문구와, 지금 번호·데이터 버전이 붙은 방 그림", async () => {
    getRoomPreview.mockResolvedValue(RESULT);
    for (const sv of ["6", "2"]) {
      const m = await meta(ROOM.toUpperCase(), { sv });
      expect(m.title).toBe("지금은 신촌이 제일 공평해요");
      expect(m.description).toBe("아직이면 출발역 넣어 주세요 · 민수 22분 · 참가자 2 19분");
      expect(og(m)).toMatchObject({
        title: "지금은 신촌이 제일 공평해요 | 반반역",
        images: [{ url: `/r/${ROOM}/og?sv=6&dv=20261115.8`, width: 1200, height: 630 }],
      });
      expect(m.robots).toEqual({ index: false, follow: false });
      expect(m.alternates).toEqual({ canonical: null });
    }
    expect(getRoomPreview).toHaveBeenCalledWith(ROOM);
  });

  it("정한 역은 '에서 만나요'와 정한 사람·약속", async () => {
    getRoomPreview.mockResolvedValue(DECIDED);
    const m = await meta(ROOM, { sv: "6" });
    expect(m.title).toBe("신촌에서 만나요");
    expect(m.description).toBe("민수가 정했어요 · 11월 21일 (토) 저녁 · 민수 22분 · 참가자 2 19분");
  });

  it("모으는 중이면 초대 문구와 사이트 기본 그림", async () => {
    getRoomPreview.mockResolvedValue({ stage: "collecting", room: { ...ROOM_PART, participantCount: 1 } });
    const m = await meta(ROOM, { sv: "6" });
    expect(m.title).toBe("같이 만날 역 정해요");
    expect(og(m)).toMatchObject({ images: [{ url: "/opengraph-image" }] });
  });

  it("번호가 지금보다 크거나 서버가 실패하면 기본 초대 문구", async () => {
    getRoomPreview.mockResolvedValue(RESULT);
    expect(await meta(ROOM, { sv: "7" })).toEqual(roomLinkMetadata());
    getRoomPreview.mockRejectedValue(new ApiRequestError(404, "ROOM_NOT_FOUND", "없음"));
    expect(await meta(ROOM, { sv: "1" })).toEqual(roomLinkMetadata());
    getRoomPreview.mockRejectedValue(new TypeError("fetch failed"));
    expect(await meta(ROOM, { sv: "1" })).toEqual(roomLinkMetadata());
  });
});
