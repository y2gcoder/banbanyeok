/**
 * 공유 링크 그림(`SharedCard`)이 다뤄야 하는 경우 목록(V1). 그리기 테스트가 모두 그리고, `OG_SCREENS_DIR`이 있으면 PR 캡처로 남긴다.
 * 이름은 서버가 주는 label·shortLabel 그대로(contracts/data-format.md §8)이고 시간은 운영 서버 응답에서 옮긴 값이다(긴 별칭·숨김·같은 역은 꾸민 값).
 */
import type { Mode, RecommendResult } from "@/lib/api/types";
import type { ShareState } from "@/lib/link/codec";
import type { TimeSlot } from "@/lib/when/time-slot";

type Person = {
  label: string;
  shortLabel: string;
  kind: "name" | "origin" | "ordinal";
  /** 출발역 이름. 숨긴 사람은 서버가 null로 준다(본인이 보는 방 화면에서만 본인 출발역이 온다). */
  origin: string | null;
  seconds: number;
  /** 출발역을 숨겼는가. 없으면 `origin`이 null일 때 숨긴 것으로 본다. */
  hidden?: boolean;
};

type Basis = { slot: TimeSlot; label: string };
const WEEKDAY_DAY: Basis = { slot: "weekday-day", label: "평일 낮" };

function person(origin: string, seconds: number): Person {
  return { label: `${origin}에서 오는 분`, shortLabel: origin, kind: "origin", origin, seconds };
}

function build(
  id: string,
  station: string,
  people: Person[],
  {
    mode = "fair",
    favorIndex = null,
    basis = WEEKDAY_DAY,
  }: { mode?: Mode; favorIndex?: number | null; basis?: Basis } = {},
): { id: string; result: RecommendResult; state: ShareState } {
  const [day = "weekday", band = "day"] = basis.slot.split("-");
  const seconds = people.map((p) => p.seconds);
  const result = {
    status: "ok",
    mode,
    dataVersion: "20261115.8",
    baselineStationCode: null,
    timeBasis: {
      timeSlot: basis.slot,
      requestedTimeSlot: basis.slot,
      dayType: day,
      band,
      label: basis.label,
      holidayName: null,
    },
    participants: people.map((p, i) => ({
      participantId: String(i),
      hidden: p.hidden ?? p.origin === null,
      originCode: p.origin === null ? null : "000",
      originName: p.origin,
      label: p.label,
      labelKind: p.kind,
      shortLabel: p.shortLabel,
    })),
    candidates: [
      {
        rank: 1,
        stationCode: "000",
        stationName: station,
        times: people.map((p, i) => ({ participantId: String(i), seconds: p.seconds, transfers: 1 })),
        maxSeconds: Math.max(...seconds),
        spreadSeconds: Math.max(...seconds) - Math.min(...seconds),
        totalSeconds: seconds.reduce((a, b) => a + b, 0),
        reasonCode: "FAIR_MINIMAX",
        reason: "",
      },
    ],
  } as RecommendResult;
  const state: ShareState = {
    origins: people.map(() => "000"),
    mode,
    favorIndex,
    nicknames: null,
    timeSlot: basis.slot,
  };
  return { id, result, state };
}

/** 숨긴 사람의 출발역(그림·설명 어디에도 나오면 안 된다). */
export const HIDDEN_ORIGIN = "선릉";

export const SHARED_CASES = [
  build("two-saturday-night", "약수", [person("혜화", 1079), person("강남", 1367)], {
    basis: { slot: "saturday-night", label: "토요일 밤" },
  }),
  build("three-favor-zero", "충무로", [person("충무로", 0), person("홍대입구", 1301), person("잠실", 1778)], {
    mode: "favor",
    favorIndex: 0,
  }),
  build("four-fair", "명동", [
    person("홍대입구", 1211),
    person("서울대입구", 1832),
    person("잠실", 1868),
    person("성수", 1238),
  ]),
  build(
    "four-fast",
    "을지로3가",
    [person("홍대입구", 1101), person("서울대입구", 1650), person("잠실", 2041), person("성수", 1312)],
    {
      mode: "fast",
    },
  ),
  build(
    "nickname-hidden",
    "왕십리",
    [
      {
        label: "우리팀막내생일축하해요오늘은내가쏜다🎂",
        shortLabel: "우리팀막내생일축하해요오늘은내가쏜다🎂",
        kind: "name",
        origin: "신촌",
        seconds: 2040,
      },
      // 방에서 출발역을 숨긴 사람: 서버가 출발역 이름을 주지 않고 이름은 "참가자 N"이다. HIDDEN_ORIGIN은 응답 어디에도 없다.
      { label: "참가자 2", shortLabel: "참가자 2", kind: "ordinal", origin: null, seconds: 1500 },
      person("잠실", 1800),
    ],
    { mode: "favor", favorIndex: 1 },
  ),
  // 출발역을 숨긴 사람 본인이 보는 경우: 서버가 본인에게만 출발역 이름(HIDDEN_ORIGIN)을 주지만 이름은 여전히 "참가자 N"이다.
  // 미리보기는 링크를 받는 모두가 보므로 이 출발역이 그림·설명에 나오면 안 된다.
  build(
    "hidden-self-view",
    "역삼",
    [
      person("강남", 300),
      { label: "참가자 2", shortLabel: "참가자 2", kind: "ordinal", origin: HIDDEN_ORIGIN, hidden: true, seconds: 240 },
      person("홍대입구", 2100),
    ],
    { mode: "favor", favorIndex: 1 },
  ),
  build("same-station", "신논현", [
    { ...person("강남", 600), label: "강남에서 오는 분 1", shortLabel: "강남 1" },
    { ...person("강남", 600), label: "강남에서 오는 분 2", shortLabel: "강남 2" },
    person("홍대입구", 1980),
  ]),
  build(
    "long-station-over-hour",
    "동대문역사문화공원",
    [person("인천", 3900), person("서울대입구", 1700), person("수원", 4020)],
    {
      basis: { slot: "holiday-evening", label: "일요일·공휴일 저녁" },
    },
  ),
];
