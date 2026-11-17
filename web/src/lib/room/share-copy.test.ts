import { describe, expect, it } from "vitest";
import type { RoomPreview, TimeBasis } from "@/lib/api/types";
import { INVITE_COPY, roomShareCopy } from "./share-copy";

const WEEKDAY_DAY: TimeBasis = {
  timeSlot: "weekday-day",
  requestedTimeSlot: "weekday-day",
  dayType: "weekday",
  band: "day",
  label: "평일 낮",
  holidayName: null,
};
const SATURDAY_EVENING: TimeBasis = {
  ...WEEKDAY_DAY,
  timeSlot: "saturday-evening",
  requestedTimeSlot: "saturday-evening",
  dayType: "saturday",
  band: "evening",
  label: "토요일 저녁",
};

type Room = Extract<RoomPreview, { stage: "result" }>["room"];

const room = (over: Partial<Room> = {}): Room => ({
  roomId: "qt7yvmsht3",
  shareVersion: 5,
  participantCount: 3,
  canJoin: true,
  meetingDate: null,
  meetingTime: null,
  meetingBand: null,
  timeBasis: WEEKDAY_DAY,
  ...over,
});

/** 민수(강남) 22분 29초, 숨긴 사람(서버가 "참가자 2"로 준다) 21분 27초, 홍대입구(이름 없음) 19분 24초. */
const TIMES = [
  { label: "민수", seconds: 1349 },
  { label: "참가자 2", seconds: 1287 },
  { label: "홍대입구", seconds: 1164 },
];

const result = (over: Partial<Extract<RoomPreview, { stage: "result" }>> = {}): RoomPreview => ({
  stage: "result",
  room: room(),
  dataVersion: "20261115.8",
  basis: { mode: "fair", favorLabel: null },
  station: { stationCode: "s1q", stationName: "동대문역사문화공원", times: TIMES },
  ...over,
});

const decided = (over: Partial<Extract<RoomPreview, { stage: "decided" }>> = {}): RoomPreview => ({
  stage: "decided",
  room: room({ meetingDate: "2026-11-21", meetingBand: "evening", timeBasis: SATURDAY_EVENING }),
  dataVersion: "20261115.8",
  basis: { mode: "fair", favorLabel: null },
  station: { stationCode: "k3a", stationName: "강남", times: TIMES },
  decidedBy: "민수",
  decidedAt: "2026-11-17T10:00:00Z",
  ...over,
});

describe("방 공유 문구", () => {
  it("모으는 중이면 지금의 초대 문구 그대로이고 그림은 사이트 기본 그림이다", () => {
    const copy = roomShareCopy({ stage: "collecting", room: room({ participantCount: 1 }) });
    expect(copy).toBe(INVITE_COPY);
    expect(copy.preview.title).toBe("같이 만날 역 정해요");
    expect(copy.message.text).toBe(
      "각자 출발역을 넣으면 모두에게 공평한 만날 역을 계산해 줘요. 출발역은 숨길 수도 있어요.",
    );
    expect(copy.message.button).toBe("카톡으로 보내기");
    expect(copy.card).toBeNull();
  });

  it("결과가 있고 더 들어올 수 있으면 지금 1위와 각자 시간, 아직 안 넣은 사람에게 한 마디", () => {
    const copy = roomShareCopy(result());
    expect(copy.stage).toBe("result");
    expect(copy.preview.title).toBe("지금은 동대문역사문화공원이 제일 공평해요");
    expect(copy.preview.description).toBe("아직이면 출발역 넣어 주세요 · 민수 22분 · 참가자 2 21분 · 홍대입구 19분");
    expect(copy.message).toEqual({ title: copy.preview.title, text: copy.preview.description, button: "결과 보내기" });
  });

  it("방의 기본 기준에 따라 제목의 이유가 바뀌고, 조사는 역 이름 받침을 따른다", () => {
    const station = { stationCode: "ryf", stationName: "홍대입구", times: TIMES };
    expect(roomShareCopy(result({ station, basis: { mode: "fast", favorLabel: null } })).preview.title).toBe(
      "지금은 홍대입구가 제일 빨라요",
    );
    expect(roomShareCopy(result({ basis: { mode: "favor", favorLabel: "민수" } })).preview.title).toBe(
      "지금은 민수 쪽으로 동대문역사문화공원이 좋아요",
    );
  });

  it("더 들어올 수 없으면(정원·잠김) 초대 없이 '에서 볼까?'와 각자 시간·기준", () => {
    const copy = roomShareCopy(result({ room: room({ canJoin: false, timeBasis: SATURDAY_EVENING }) }));
    expect(copy.preview.title).toBe("동대문역사문화공원에서 볼까?");
    expect(copy.preview.description).toBe(
      "민수 22분 · 참가자 2 21분 · 홍대입구 19분 · 공평하게 고름 · 토요일 저녁 기준",
    );
    expect(copy.preview.description).not.toContain("출발역 넣어");
  });

  it("정한 역은 '에서 만나요', 정한 사람과 약속, 각자 시간이고 초대 문구가 없다", () => {
    const copy = roomShareCopy(decided());
    expect(copy.stage).toBe("decided");
    expect(copy.preview.title).toBe("강남에서 만나요");
    expect(copy.preview.description).toBe(
      "민수가 정했어요 · 11월 21일 (토) 저녁 · 민수 22분 · 참가자 2 21분 · 홍대입구 19분",
    );
    expect(copy.message.button).toBe("정한 역 알리기");
    expect(copy.card).toMatchObject({
      stationName: "강남",
      suffix: "에서 만나요",
      footer: { main: "민수가 정했어요", sub: "11월 21일 (토) 저녁" },
    });
  });

  it("정한 사람이 숨긴 사람이면 서버가 준 '참가자 N'으로, 약속이 없으면 그 칸을 뺀다", () => {
    const copy = roomShareCopy(decided({ decidedBy: "참가자 2", room: room() }));
    expect(copy.preview.description).toBe("참가자 2가 정했어요 · 민수 22분 · 참가자 2 21분 · 홍대입구 19분");
    expect(copy.card?.footer).toEqual({ main: "참가자 2가 정했어요", sub: "가장 오래 걸려도 22분" });
  });

  it("정한 역이 상위 3곳 밖이라 누군가 갈 수 없으면 글에서는 빼고 그림에는 남긴다", () => {
    const times = [
      { label: "민수", seconds: 600 },
      { label: "참가자 2", seconds: null },
    ];
    const copy = roomShareCopy(decided({ station: { stationCode: "zzz", stationName: "소요산", times } }));
    expect(copy.preview.description).toBe("민수가 정했어요 · 11월 21일 (토) 저녁 · 민수 10분");
    expect(copy.card?.people).toEqual([
      { name: "민수", minutes: 10, favored: false },
      { name: "참가자 2", minutes: null, favored: false },
    ]);
  });

  it("시간은 화면과 같은 반올림 규칙(30초 올림)", () => {
    const times = [
      { label: "가", seconds: 29 },
      { label: "나", seconds: 30 },
    ];
    expect(roomShareCopy(result({ station: { stationCode: "s1q", stationName: "신촌", times } })).card?.people).toEqual(
      [
        { name: "가", minutes: 0, favored: false },
        { name: "나", minutes: 1, favored: false },
      ],
    );
  });

  it("긴 이름은 글에는 그대로, 그림에는 글꼴에 있는 글자만 잘라서 넣는다", () => {
    const long = "지연이와 함께 오는 아주 긴 이름";
    const emoji = "🎂🎂";
    const times = [
      { label: long, seconds: 600 },
      { label: emoji, seconds: 700 },
    ];
    const copy = roomShareCopy(result({ station: { stationCode: "s1q", stationName: "신촌", times } }));
    expect(copy.preview.description).toContain(`${long} 10분`);
    expect(copy.card?.people.map((p) => p.name)).toEqual(["지연이와 함께 오는…", "참가자 2"]);
  });

  it("배려 기준이면 그 사람의 노선만 진하게 그린다(정한 역은 기준과 무관하게 모두 같게)", () => {
    const favor = roomShareCopy(result({ basis: { mode: "favor", favorLabel: "홍대입구" } }));
    expect(favor.card?.people.map((p) => p.favored)).toEqual([false, false, true]);
    expect(favor.card?.modeLine).toBe("홍대입구 쪽으로 고름");
    const done = roomShareCopy(decided({ basis: { mode: "favor", favorLabel: "홍대입구" } }));
    expect(done.card?.people.map((p) => p.favored)).toEqual([false, false, false]);
  });

  it("출발역 이름은 서버가 주지 않으므로 어떤 문구에도 나올 수 없다(숨긴 사람은 '참가자 N')", () => {
    for (const preview of [result(), decided(), result({ room: room({ canJoin: false }) })]) {
      const text = JSON.stringify(roomShareCopy(preview));
      expect(text).toContain("참가자 2");
      expect(text).not.toContain("신촌");
    }
  });
});
