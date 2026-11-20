/**
 * 방 미리보기 그림(`/r/<id>/og`, `SharedCard`)의 표본. 그리기 검사(`og-render.test.tsx`)와 그림 버전 해시(`og-image-version.test.ts`)가
 * 같이 쓴다: 여기 값을 바꾸면 해시가 달라지므로 `ROOM_OG_IMAGE_VERSION`을 함께 올린다. 입력은 서버 미리보기(`RoomPreview`) 그대로다.
 * `lastTrains`는 막차 줄 스위치(`ROOM_PREVIEW_LAST_TRAIN`)를 **켰을 때** 사람마다 그려지는 줄이다. 꺼진 지금은 모두 줄이 없다.
 */
import type { RoomPreview } from "@/lib/api/types";

type Result = Extract<RoomPreview, { stage: "result" }>;

const ROOM: Result["room"] = {
  roomId: "qt7yvmsht3",
  shareVersion: 9,
  participantCount: 3,
  canJoin: true,
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
};

/** 03:00 전 약속은 전날(금요일) 운행일의 밤이다. */
const DAWN_BASIS: Result["room"]["timeBasis"] = {
  timeSlot: "weekday-night",
  requestedTimeSlot: "weekday-night",
  dayType: "weekday",
  band: "night",
  label: "평일 밤",
  holidayName: null,
};

const STATION: Result["station"] = {
  stationCode: "s1q",
  stationName: "동대문역사문화공원",
  // 막차(#62): 출발역을 숨긴 "참가자 2"에게는 서버가 키를 주지 않는다.
  times: [
    {
      label: "민수",
      seconds: 1349,
      lastTrain: { kind: "direct", minute: 1443, boundFor: { stationCode: "dzc", stationName: "광교" } },
    },
    { label: "참가자 2", seconds: 1287 },
    {
      label: "지연이와 함께 오는 아주 긴 이름",
      seconds: 1164,
      lastTrain: { kind: "margin", minute: 1389, transfer: true },
    },
  ],
};

/** 신도림: 강남 방면 직행 막차가 금요일 운행일 24:27(= 토요일 00:27), 토요일 운행일에는 23:27이다. */
function sindorim(directMinute: number): Result["station"] {
  return {
    stationCode: "kxk",
    stationName: "신도림",
    times: [
      {
        label: "강남",
        seconds: 1500,
        lastTrain: { kind: "direct", minute: directMinute, boundFor: { stationCode: "kf1", stationName: "삼성" } },
      },
      { label: "지연", seconds: 1320, lastTrain: { kind: "margin", minute: directMinute - 21, transfer: true } },
    ],
  };
}

export const ROOM_CASES: { id: string; preview: RoomPreview; lastTrains: (string | null)[] }[] = [
  {
    id: "room-result-favor",
    preview: {
      stage: "result",
      room: ROOM,
      dataVersion: "1",
      basis: { mode: "favor", favorLabel: "민수" },
      station: STATION,
    },
    lastTrains: ["막차 다음 날 00:03", null, "늦어도 23:00"],
  },
  {
    id: "room-decided",
    preview: {
      stage: "decided",
      room: ROOM,
      dataVersion: "1",
      basis: { mode: "fair", favorLabel: null },
      station: { ...STATION, times: [...STATION.times.slice(0, 2), { label: "🎂", seconds: null }] },
      decidedBy: "참가자 2",
      decidedAt: "2026-11-17T10:00:00Z",
    },
    lastTrains: ["막차 다음 날 00:03", null, null],
  },
  {
    // 4명: 가장 긴 줄 "늦어도 다음 날 00:00"과 확인 필요(줄 없음)가 섞인다.
    id: "room-four-next-day",
    preview: {
      stage: "result",
      room: { ...ROOM, participantCount: 4, canJoin: false },
      dataVersion: "1",
      basis: { mode: "fair", favorLabel: null },
      station: {
        stationCode: "g0m",
        stationName: "금정",
        times: [
          { label: "강남", seconds: 2340, lastTrain: { kind: "margin", minute: 1449, transfer: true } },
          { label: "참가자 2", seconds: 3060 },
          { label: "고색", seconds: 1500, lastTrain: { kind: "check" } },
          { label: "홍대입구", seconds: 3120, lastTrain: { kind: "margin", minute: 1423, transfer: true } },
        ],
      },
    },
    lastTrains: ["늦어도 다음 날 00:00", null, null, "늦어도 23:40"],
  },
  {
    // 토요일 02:59 약속(금요일 운행일): 토요일 00:27 막차와 00:00 여유 시각은 약속보다 먼저라 귀가 시각으로 그리지 않는다.
    id: "room-dawn-before",
    preview: {
      stage: "result",
      room: { ...ROOM, meetingDate: "2026-11-28", meetingTime: "02:59", meetingBand: "night", timeBasis: DAWN_BASIS },
      dataVersion: "1",
      basis: { mode: "fair", favorLabel: null },
      station: sindorim(1467),
    },
    lastTrains: [null, null],
  },
  {
    // 같은 날 03:00 약속(토요일 운행일): 그날 밤 23:27 막차는 약속 뒤다.
    id: "room-dawn-after",
    preview: {
      stage: "result",
      room: { ...ROOM, meetingDate: "2026-11-28", meetingTime: "03:00", meetingBand: "night" },
      dataVersion: "1",
      basis: { mode: "fair", favorLabel: null },
      station: sindorim(1407),
    },
    lastTrains: ["막차 23:27", "늦어도 23:00"],
  },
];
