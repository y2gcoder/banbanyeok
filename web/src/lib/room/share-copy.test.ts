import { describe, expect, it } from "vitest";
import type { RoomPreview, TimeBasis } from "@/lib/api/types";
import { ROOM_OG_IMAGE_VERSION, ROOM_SHARE_POLICY_VERSION, SITE_OG_IMAGE_PATH } from "@/lib/copy/og-text";
import { kakaoFeedSettings } from "@/lib/share/kakao";
import { INVITE_COPY, ROOM_PREVIEW_LAST_TRAIN, roomKakaoMessage, roomShareCopy } from "./share-copy";

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
    expect(copy.message).toEqual({
      title: copy.preview.title,
      text: copy.preview.description,
      button: "카톡으로 결과 보내기",
    });
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

  it("뽑기 방에서 뽑은 뒤 메신저 미리보기(og 제목·설명·그림)와 공유 문구에는 당첨자와 1위 역·시간을 넣지 않는다(미리보기 응답은 그대로, #172)", () => {
    const basis = { mode: "favor" as const, favorLabel: "민수", drawRound: 1 };
    const open = roomShareCopy(result({ basis }));
    expect(open.preview.title).toBe("사다리 결과가 나왔어요! 누구 쪽일까요?");
    expect(open.preview.description).toBe(
      "아직이면 출발역 넣어 주세요 · 민수 · 참가자 2 · 홍대입구 · 사다리 결과는 방에서 확인해요",
    );
    expect(open.message.title).toBe(open.preview.title);
    const full = roomShareCopy(result({ basis, room: room({ canJoin: false }) }));
    expect(full.preview.description).toBe("민수 · 참가자 2 · 홍대입구 · 사다리 결과는 방에서 확인해요");
    for (const copy of [open, full]) {
      const all = JSON.stringify(copy);
      expect(all).not.toContain("동대문역사문화공원");
      expect(all).not.toContain("민수 쪽으로");
      expect(all).not.toMatch(/\d+분/);
      expect(copy.card?.stationCode).toBeUndefined();
      expect(copy.card?.teaser).toBe(true);
      expect(copy.card?.people.map((p) => [p.name, p.minutes, p.favored])).toEqual([
        ["민수", null, false],
        ["참가자 2", null, false],
        ["홍대입구", null, false],
      ]);
    }
    // 뽑기 전(서버가 공평하게로 주고 회차가 없다)과 정한 역 단계는 지금 그대로다.
    expect(roomShareCopy(result()).preview.title).toBe("지금은 동대문역사문화공원이 제일 공평해요");
    expect(roomShareCopy(decided({ basis })).preview.title).toBe("강남에서 만나요");
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
    expect(copy.message.button).toBe("카톡으로 정한 역 알리기");
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

  it("글꼴에 남는 글자가 없는 이름(이모지만)이 배려 대상·정한 사람이면 그림의 기준 줄도 줄과 같은 '참가자 N'이다", () => {
    const times = [
      { label: "민수", seconds: 600 },
      { label: "🎂", seconds: 700 },
      { label: "🍕", seconds: 800 },
    ];
    const station = { stationCode: "s1q", stationName: "신촌", times };
    const favor = roomShareCopy(result({ station, basis: { mode: "favor", favorLabel: "🎂" } }));
    expect(favor.card?.people.map((p) => p.name)).toEqual(["민수", "참가자 2", "참가자 3"]);
    expect(favor.card?.modeLine).toBe("참가자 2 쪽으로 고름");
    const done = roomShareCopy(decided({ station, decidedBy: "🍕", room: room() }));
    expect(done.card?.modeLine).toBe("참가자 3이 정했어요");
    expect(done.card?.footer?.main).toBe("참가자 3이 정했어요");
    const second = roomShareCopy(decided({ station, decidedBy: "🎂", room: room() }));
    expect(second.card?.footer?.main).toBe("참가자 2가 정했어요");
    const twins = [times[1], times[1]].flatMap((t) => (t ? [t] : []));
    const same = roomShareCopy(result({ station: { ...station, times: twins } }));
    expect(same.card?.people.map((p) => p.name)).toEqual(["참가자 1", "참가자 2"]);
  });

  it("막차(#62) 스위치는 6항에 막차를 적은 판(#84)부터 켜져 있고, 끄면 서버가 막차를 주어도 막차를 모르던 때와 같다", () => {
    // 처리방침 6항이 방 링크 미리보기 목록에 '공개한 참여자의 귀갓길 막차 시각'을 적은 판부터 켠다(policy.test.ts의 지킴이).
    expect(ROOM_PREVIEW_LAST_TRAIN).toBe(true);
    const off = { lastTrain: false };
    const withLastTrain = (label: string, seconds: number, minute: number) => ({
      label,
      seconds,
      lastTrain: { kind: "direct" as const, minute, boundFor: { stationCode: "dzc", stationName: "광교" } },
    });
    const times = [withLastTrain("민수", 1349, 1443), TIMES[1], withLastTrain("홍대입구", 1164, 1389)].flatMap((t) =>
      t ? [t] : [],
    );
    const basis = { dayType: "weekday" as const, asOf: "2026-11-16" };
    const station = { stationCode: "s1q", stationName: "동대문역사문화공원", times };
    const plain = { ...station, times: TIMES };
    const pairs: [RoomPreview, RoomPreview][] = [
      [result({ station, lastTrainBasis: basis }), result({ station: plain })],
      [decided({ station, lastTrainBasis: basis }), decided({ station: plain })],
      [
        result({ station, lastTrainBasis: basis, room: room({ meetingDate: "2026-11-28", meetingTime: "02:59" }) }),
        result({ station: plain, room: room({ meetingDate: "2026-11-28", meetingTime: "02:59" }) }),
      ],
    ];
    for (const [withTrains, without] of pairs) {
      // 기본은 켠 것과 같다.
      expect(roomShareCopy(withTrains)).toEqual(roomShareCopy(withTrains, { lastTrain: true }));
      // 끄면 막차가 실린 미리보기와 막차를 모르는 서버의 미리보기가 같은 문구·같은 그림 값이 된다.
      expect(roomShareCopy(withTrains, off)).toEqual(roomShareCopy(without, off));
      expect(roomShareCopy(withTrains, off).card?.people.every((p) => !("lastTrain" in p))).toBe(true);
      expect(JSON.stringify(roomShareCopy(withTrains, off))).not.toMatch(/막차|늦어도|다음 날|광교/);
      // 켜도 글(미리보기 설명·공유 문구)에는 막차가 없다.
      const { preview, message } = roomShareCopy(withTrains);
      expect(JSON.stringify([preview, message])).not.toMatch(/막차|늦어도|다음 날|광교/);
      // 카카오톡 메시지(글과 그림 주소)는 막차와 상관없이 같다.
      expect(roomKakaoMessage("qt7yvmsht3", withTrains)).toEqual(roomKakaoMessage("qt7yvmsht3", without));
    }
  });

  it("막차(#62) 스위치를 켰을 때: 그림에만 작은 줄로 넣고, 글(미리보기 설명·공유 문구)에는 넣지 않는다", () => {
    const on = { lastTrain: true };
    const station = {
      stationCode: "k3a",
      stationName: "강남",
      // 숨긴 "참가자 2"에게는 서버가 막차 키를 주지 않는다. 홍대입구는 갈아타는 여유 시각(23:09 → 23:00)이다.
      times: [
        {
          label: "민수",
          seconds: 1349,
          lastTrain: {
            kind: "direct" as const,
            minute: 1443,
            boundFor: { stationCode: "dzc", stationName: "광교" },
          },
        },
        { label: "참가자 2", seconds: 1287 },
        { label: "홍대입구", seconds: 1164, lastTrain: { kind: "margin" as const, minute: 1389, transfer: true } },
      ],
    };
    const basis = { dayType: "weekday" as const, asOf: "2026-11-16" };
    for (const preview of [result({ station, lastTrainBasis: basis }), decided({ station, lastTrainBasis: basis })]) {
      const copy = roomShareCopy(preview, on);
      // 자정을 넘긴 시각은 그림에서도 "다음 날"을 붙인다(그림만 보면 "00:03"이 그날 새벽으로 읽힌다).
      expect(copy.card?.people.map((p) => p.lastTrain ?? null)).toEqual(["막차 다음 날 00:03", null, "늦어도 23:00"]);
      const words = JSON.stringify([copy.preview, copy.message]);
      expect(words).not.toContain("막차");
      expect(words).not.toContain("늦어도");
      expect(words).not.toContain("광교");
    }
    // 새벽 약속(#83 검토): 토요일 02:59 약속은 금요일 운행일이라 24:03(토요일 00:03) 막차와 23:00 여유 시각이 약속보다 먼저다.
    // 귀가 시각으로 그리지 않는다. 03:00 약속은 토요일 운행일이라 같은 분이 그날 밤(일요일 00:03)이다.
    const dawn = (meetingTime: string) =>
      roomShareCopy(
        result({ station, lastTrainBasis: basis, room: room({ meetingDate: "2026-11-28", meetingTime }) }),
        on,
      ).card?.people.map((p) => p.lastTrain ?? null);
    expect(dawn("02:59")).toEqual([null, null, null]);
    expect(dawn("03:00")).toEqual(["막차 다음 날 00:03", null, "늦어도 23:00"]);
    // 자정 뒤 약속보다 늦게 떠나는 열차는 약속일과 같은 날이다: "다음 날"을 붙이지 않는다.
    expect(dawn("00:00")).toEqual(["막차 00:03", null, null]);
    // 약속과 같은 분에 떠나는 열차도 그리지 않는다(약속을 시작하는 순간 떠나 귀갓길에 탈 수 없다). 1분 뒤부터 그린다.
    expect(dawn("00:03")).toEqual([null, null, null]);
    expect(dawn("00:02")).toEqual(["막차 00:03", null, null]);
    // 확인 필요는 줄이 없다. 막차를 모르는 서버의 미리보기(키 없음)는 그림 값이 예전과 같다.
    const unknown = result({
      station: { ...station, times: station.times.map((t) => ({ ...t, lastTrain: { kind: "check" as const } })) },
    });
    expect(roomShareCopy(unknown, on).card?.people.every((p) => !("lastTrain" in p))).toBe(true);
    expect(roomShareCopy(result(), on).card?.people.every((p) => !("lastTrain" in p))).toBe(true);
    // 켜도 막차를 모르는 미리보기의 그림 값은 끈 것과 같다.
    expect(roomShareCopy(result(), on)).toEqual(roomShareCopy(result()));
  });

  describe("지도 한가운데 비교(#68 2단계)", () => {
    /** 홍대입구·잠실 방: 1위 신당(21분·22분), 지도 한가운데 한강진(23분·36분). */
    const station = {
      stationCode: "7gf",
      stationName: "신당",
      times: [
        { label: "민수", seconds: 1271 },
        { label: "잠실", seconds: 1301 },
      ],
    };
    const minsu = { label: "민수", seconds: 1412 };
    const mapMiddle = { stationCode: "j7v", stationName: "한강진", times: [minsu, { label: "잠실", seconds: 2159 }] };
    const sentence = "지도 한가운데인 한강진역이면 잠실은 14분 더 걸려요";

    it("서버가 준 1위 단계에서는 설명·공유 문구 끝과 그림 맨 아래에 같은 문장을 붙인다", () => {
      const open = roomShareCopy(result({ station, mapMiddle, room: room({ participantCount: 2 }) }));
      expect(open.preview.description).toBe(`아직이면 출발역 넣어 주세요 · 민수 21분 · 잠실 22분 · ${sentence}`);
      expect(open.message.text).toBe(open.preview.description);
      expect(open.card?.middleLine).toBe(sentence);
      const full = roomShareCopy(result({ station, mapMiddle, room: room({ canJoin: false }) }));
      expect(full.preview.description).toBe(`민수 21분 · 잠실 22분 · 공평하게 고름 · ${sentence}`);
      expect(roomKakaoMessage("qt7yvmsht3", result({ station, mapMiddle })).description).toContain(sentence);
    });

    it("키가 없으면(숨긴 사람이 있는 방·조건 미달·옛 서버) 비교만 빠지고 나머지는 그대로다", () => {
      const withMiddle = roomShareCopy(result({ station, mapMiddle }));
      const without = roomShareCopy(result({ station }));
      expect(without.preview.description).toBe(withMiddle.preview.description.replace(` · ${sentence}`, ""));
      expect(without.card?.middleLine).toBeUndefined();
      const { middleLine: _middleLine, ...rest } = withMiddle.card ?? { people: [] };
      expect(without.card).toEqual(rest);
    });

    it("공평 기준이 아니거나, 1위와 같은 역이거나, 화면 분으로 5분 미만이거나, 사람 수가 맞지 않으면 값이 와도 쓰지 않는다", () => {
      const cases: RoomPreview[] = [
        result({ station, mapMiddle, basis: { mode: "fast", favorLabel: null } }),
        result({ station, mapMiddle, basis: { mode: "favor", favorLabel: "민수" } }),
        result({ station, mapMiddle: { ...mapMiddle, stationCode: station.stationCode } }),
        // 가장 오래: 신당 22분, 한강진 26분(4분 더): 보이지 않는다.
        result({ station, mapMiddle: { ...mapMiddle, times: [minsu, { label: "잠실", seconds: 1560 }] } }),
        result({ station, mapMiddle: { ...mapMiddle, times: mapMiddle.times.slice(0, 1) } }),
      ];
      for (const preview of cases) {
        const copy = roomShareCopy(preview);
        expect(copy.preview.description).not.toContain("지도 한가운데");
        expect(copy.card?.middleLine).toBeUndefined();
      }
      // 5분이면 보인다(화면 분 기준: 22분 → 27분).
      const five = result({ station, mapMiddle: { ...mapMiddle, times: [minsu, { label: "잠실", seconds: 1620 }] } });
      expect(roomShareCopy(five).card?.middleLine).toBe("지도 한가운데인 한강진역이면 잠실은 5분 더 걸려요");
    });

    it("정한 역 단계에는 비교가 없다", () => {
      const copy = roomShareCopy(decided({ station }));
      expect(copy.preview.description).not.toContain("지도 한가운데");
      expect(copy.card?.middleLine).toBeUndefined();
    });
  });

  it("출발역 이름은 서버가 주지 않으므로 어떤 문구에도 나올 수 없다(숨긴 사람은 '참가자 N')", () => {
    for (const preview of [result(), decided(), result({ room: room({ canJoin: false }) })]) {
      const text = JSON.stringify(roomShareCopy(preview));
      expect(text).toContain("참가자 2");
      expect(text).not.toContain("신촌");
    }
  });
});

describe("카카오톡 공유 메시지", () => {
  const ORIGIN = "https://banbanyeok.app";
  const sent = (preview: RoomPreview | undefined) => kakaoFeedSettings(roomKakaoMessage("qt7yvmsht3", preview), ORIGIN);
  const ROOM_LINK = `https://banbanyeok.app/r/qt7yvmsht3?sv=5&pv=${ROOM_SHARE_POLICY_VERSION}`;
  const roomLink = { webUrl: ROOM_LINK, mobileWebUrl: ROOM_LINK };

  it("결과가 있고 더 들어올 수 있으면 공유 시트와 같은 문구, 그 번호의 방 그림, '내 출발역 넣기' 버튼 하나", () => {
    expect(sent(result())).toEqual({
      objectType: "feed",
      content: {
        title: "지금은 동대문역사문화공원이 제일 공평해요",
        description: "아직이면 출발역 넣어 주세요 · 민수 22분 · 참가자 2 21분 · 홍대입구 19분",
        imageUrl: `https://banbanyeok.app/r/qt7yvmsht3/og?sv=5&dv=20261115.8&pv=${ROOM_SHARE_POLICY_VERSION}&iv=${ROOM_OG_IMAGE_VERSION}`,
        imageWidth: 1200,
        imageHeight: 630,
        link: roomLink,
      },
      buttons: [{ title: "내 출발역 넣기", link: roomLink }],
    });
  });

  it("더 들어올 수 없으면 '결과 보기', 정했으면 '방 보기'이고 링크는 늘 그 미리보기의 번호다", () => {
    const full = sent(result({ room: room({ canJoin: false, shareVersion: 9 }) }));
    expect(full.content.title).toBe("동대문역사문화공원에서 볼까?");
    expect(full.buttons).toEqual([{ title: "결과 보기", link: full.content.link }]);
    expect(full.content.link.webUrl).toBe(`https://banbanyeok.app/r/qt7yvmsht3?sv=9&pv=${ROOM_SHARE_POLICY_VERSION}`);
    expect(full.content.imageUrl).toBe(
      `https://banbanyeok.app/r/qt7yvmsht3/og?sv=9&dv=20261115.8&pv=${ROOM_SHARE_POLICY_VERSION}&iv=${ROOM_OG_IMAGE_VERSION}`,
    );

    const done = sent(decided());
    expect(done.content.title).toBe("강남에서 만나요");
    expect(done.content.description).toBe(
      "민수가 정했어요 · 11월 21일 (토) 저녁 · 민수 22분 · 참가자 2 21분 · 홍대입구 19분",
    );
    expect(done.buttons).toEqual([{ title: "방 보기", link: roomLink }]);
  });

  it("모으는 중이나 미리보기가 없으면 초대 문구와 사이트 기본 그림, 미리보기가 없으면 번호 없는 링크", () => {
    const collecting = sent({ stage: "collecting", room: room({ participantCount: 1 }) });
    expect(collecting.content).toMatchObject({
      title: INVITE_COPY.message.title,
      description: INVITE_COPY.message.text,
      imageUrl: `https://banbanyeok.app${SITE_OG_IMAGE_PATH}`,
      link: roomLink,
    });
    expect(collecting.buttons).toEqual([{ title: "내 출발역 넣기", link: roomLink }]);

    const unknown = sent(undefined);
    const bare = "https://banbanyeok.app/r/qt7yvmsht3";
    expect(unknown.content.link).toEqual({ webUrl: bare, mobileWebUrl: bare });
    expect(unknown.content.imageUrl).toBe(`https://banbanyeok.app${SITE_OG_IMAGE_PATH}`);
    expect(unknown.buttons).toEqual([{ title: "내 출발역 넣기", link: { webUrl: bare, mobileWebUrl: bare } }]);
  });

  it("모든 링크와 그림은 이 사이트의 출처이고 버튼은 카카오 한도(2개) 안이다", () => {
    for (const preview of [undefined, result(), result({ room: room({ canJoin: false }) }), decided()]) {
      const settings = sent(preview);
      const urls = [settings.content.imageUrl, settings.content.link.webUrl, settings.content.link.mobileWebUrl];
      for (const button of settings.buttons) urls.push(button.link.webUrl, button.link.mobileWebUrl);
      for (const url of urls) expect(new URL(url).origin).toBe(ORIGIN);
      expect(settings.buttons.length).toBeGreaterThan(0);
      expect(settings.buttons.length).toBeLessThanOrEqual(2);
    }
  });

  it("이름은 글이라 이모지도 그대로 가고, 숨긴 사람은 '참가자 N'이며 출발역 이름은 어디에도 없다", () => {
    const times = [
      { label: "🎂", seconds: 600 },
      { label: "참가자 2", seconds: 700 },
    ];
    const station = { stationCode: "s1q", stationName: "동대문역사문화공원", times };
    for (const preview of [result({ station }), decided({ station, decidedBy: "🎂" })]) {
      const text = JSON.stringify(sent(preview));
      expect(text).toContain("🎂 10분");
      expect(text).toContain("참가자 2 12분");
      expect(text).not.toContain("신촌");
    }
  });
});
