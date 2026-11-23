/**
 * 공유 링크 그림(`SharedCard`)이 다뤄야 하는 경우 목록(V1). 그리기 테스트가 모두 그리고, `OG_SCREENS_DIR`이 있으면 PR 캡처로 남긴다.
 * 이름은 서버가 주는 label·shortLabel 그대로(contracts/data-format.md §8)이고 시간은 운영 서버 응답에서 옮긴 값이다(긴 별칭·숨김·같은 역은 꾸민 값).
 */
import type { Mode, RecommendResult } from "@/lib/api/types";
import type { ShareState } from "@/lib/link/codec";
import { searchStations } from "@/lib/stations";
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
const WEEKDAY_NIGHT: Basis = { slot: "weekday-night", label: "평일 밤" };

/** 한 사람의 막차(#62). 서버 응답의 `lastTrains[]`에서 참가자 ID를 뺀 모양이고, 사람 순서대로 적는다. */
type LastTrain = Omit<NonNullable<RecommendResult["candidates"][number]["lastTrains"]>[number], "participantId">;
const direct = (minute: number, bound: string): LastTrain => ({
  kind: "direct",
  minute,
  boundFor: { stationCode: "002", stationName: bound },
});
const changing = (minute: number): LastTrain => ({ kind: "margin", minute, transfer: true });
const noTime: LastTrain = { kind: "check" };

function person(origin: string, seconds: number): Person {
  return { label: `${origin}에서 오는 분`, shortLabel: origin, kind: "origin", origin, seconds };
}

/** 이름에 대응하는 실제 수도권 코드로 배지도 실제 경로처럼 그린다. */
function sampleStationCode(name: string): string {
  const station = searchStations(name).find((s) => s.name === name && s.supported);
  if (!station) throw new Error(`표본 역 없음: ${name}`);
  return station.code;
}

function build(
  id: string,
  station: string,
  people: Person[],
  {
    mode = "fair",
    favorIndex = null,
    basis = WEEKDAY_DAY,
    middle,
    lastTrains,
  }: {
    mode?: Mode;
    favorIndex?: number | null;
    basis?: Basis;
    /** 서버가 주는 "지도 한가운데" 역과 각자 시간(초). 없으면 키가 없는 응답(옛 서버·조건 미달)이다. */
    middle?: { station: string; seconds: number[] };
    /**
     * 사람 순서대로의 막차. `null`은 서버가 항목을 주지 않은 사람(출발역을 숨긴 다른 사람)이다. 없으면 막차를 모르는 응답이다.
     */
    lastTrains?: (LastTrain | null)[];
  } = {},
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
      // 숨겼는데 출발역이 오는 사람은 이 화면을 보는 본인이다(서버는 본인에게만 본인 출발역을 준다).
      ...(p.hidden && p.origin !== null ? { isSelf: true } : {}),
      originCode: p.origin === null ? null : p.hidden ? sampleStationCode(p.origin) : "000",
      originName: p.origin,
      label: p.label,
      labelKind: p.kind,
      shortLabel: p.shortLabel,
    })),
    candidates: [
      {
        rank: 1,
        // 출발역 코드("000")와 다르고, 호선 배지를 그릴 수 있는 실제 코드다.
        stationCode: sampleStationCode(station),
        stationName: station,
        times: people.map((p, i) => ({ participantId: String(i), seconds: p.seconds, transfers: 1 })),
        maxSeconds: Math.max(...seconds),
        spreadSeconds: Math.max(...seconds) - Math.min(...seconds),
        totalSeconds: seconds.reduce((a, b) => a + b, 0),
        reasonCode: "FAIR_MINIMAX",
        reason: "",
        ...(lastTrains
          ? {
              lastTrains: lastTrains.flatMap((entry, i) => (entry ? [{ participantId: String(i), ...entry }] : [])),
            }
          : {}),
      },
    ],
    ...(lastTrains ? { lastTrainBasis: { dayType: day, asOf: "2026-11-16" } } : {}),
    ...(middle
      ? {
          mapMiddle: {
            stationCode: sampleStationCode(middle.station),
            stationName: middle.station,
            times: middle.seconds.map((sec, i) => ({ participantId: String(i), seconds: sec, transfers: 1 })),
          },
        }
      : {}),
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
/** 숨긴 사람 본인에게만 오는 막차의 행선지. 이것도 그림·설명 어디에도 나오면 안 된다. */
const HIDDEN_BOUND = "숨긴행선지";

export const SHARED_CASES = [
  // 막차 줄(#62): 직행 확정은 분 그대로("막차 00:03"), 여유 시각은 10분 단위로 내려("늦어도 23:00"), 확인 필요는 줄이 빈다.
  build("two-last-train", "강남", [person("광교", 2400), person("부천", 3000)], {
    basis: WEEKDAY_NIGHT,
    lastTrains: [direct(1443, "광교"), changing(1389)],
  }),
  build(
    "four-last-train-middle",
    "을지로3가",
    [person("홍대입구", 1101), person("서울대입구", 1650), person("김포공항", 2941), person("고색", 4020)],
    {
      basis: WEEKDAY_NIGHT,
      middle: { station: "동대문역사문화공원", seconds: [1500, 1700, 3300, 3700] },
      lastTrains: [
        direct(1478, "신도림"),
        changing(1431),
        { kind: "margin", minute: 1425, transfer: false, boundFor: { stationCode: "003", stationName: "김포공항" } },
        noTime,
      ],
    },
  ),
  // 공유 카드 "A 숫자판"(#68): 지도 한가운데 비교가 붙는 경우. 시간은 로컬 서버 응답에서 옮긴 근사값이다(홍대입구·잠실은 신당 21분 안팎, 한강진 24·36분).
  build("two-even-middle", "신당", [person("홍대입구", 1260), person("잠실", 1260)], {
    middle: { station: "한강진", seconds: [1380, 2100] },
  }),
  build("two-middle-saturday", "충무로", [person("강남", 1500), person("수유", 1320)], {
    basis: { slot: "saturday-night", label: "토요일 밤" },
    middle: { station: "신당", seconds: [1860, 1500] },
  }),
  build("three-middle", "교대", [person("구로디지털단지", 1320), person("잠실", 960), person("홍대입구", 1380)], {
    middle: { station: "고속터미널", seconds: [1740, 1380, 1980] },
  }),
  build(
    "four-middle-long-name",
    "을지로3가",
    [
      {
        label: "우리팀막내생일축하해요",
        shortLabel: "우리팀막내생일축하해요",
        kind: "name",
        origin: "신촌",
        seconds: 1500,
      },
      person("서울대입구", 1560),
      person("잠실", 1500),
      person("성수", 1440),
    ],
    { middle: { station: "동대문역사문화공원", seconds: [2160, 1620, 1440, 1800] } },
  ),
  build(
    "three-middle-over-hour",
    "안양",
    [person("구로디지털단지", 2100), person("수원", 1680), person("인천", 3900)],
    {
      basis: { slot: "holiday-evening", label: "일요일·공휴일 저녁" },
      middle: { station: "금정", seconds: [2460, 1380, 4260] },
    },
  ),
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
    // 숨긴 사람의 막차는 서버가 주지 않는다.
    { mode: "favor", favorIndex: 1, lastTrains: [changing(1402), null, direct(1474, "성수")] },
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
    // 본인에게는 서버가 본인의 막차도 준다. 미리보기 그림에는 넣지 않는다.
    { mode: "favor", favorIndex: 1, lastTrains: [direct(1484, "성수"), direct(1479, HIDDEN_BOUND), changing(1432)] },
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
