/**
 * "집에 가는 막차"(#62)를 화면 값으로 바꾼다. 서버는 값과 분류만 준다(`Candidate.lastTrains`, `Result.lastTrainBasis`):
 * 직행 확정(`direct`)은 분 그대로, 여유 시각(`margin`)은 **10분 단위로 내려** 보이고, 확인 필요(`check`)는 시각 없이 이유만 말한다.
 * 계산·순위는 하지 않는다. 문구는 모두 여기서 만든다(화면·공유 그림이 같은 말을 쓰고, 쓰지 않는 말 검사를 한 곳에서 한다).
 *
 * 시각은 만날 역에서 열차를 타는 시각이고 **운행일의 분**이다(03:00에 운행일이 바뀐다): 1390 = 23:10, 1443 = 다음 날 00:03.
 */
import type { RecommendResult } from "@/lib/api/types";
import { stationLabel, withJosa } from "@/lib/display/korean";
import { DAY_TYPES } from "@/lib/when/time-slot";

type Basis = NonNullable<RecommendResult["lastTrainBasis"]>;
/** 방 미리보기의 항목(`PreviewTime.lastTrain`)도 같은 모양이다(참가자 ID만 없다). */
export type LastTrainEntry = Pick<
  NonNullable<RecommendResult["candidates"][number]["lastTrains"]>[number],
  "kind" | "minute" | "transfer" | "boundFor"
>;

const DAY_MINUTES = 24 * 60;
const MARGIN_STEP = 10;

/** 화면에 보이는 분. 여유 시각만 10분 단위로 내린다(올림·반올림은 하지 않는다). */
function shownMinute(kind: "direct" | "margin", minute: number): number {
  return kind === "direct" ? minute : minute - (minute % MARGIN_STEP);
}

/** "23:10". 자정을 넘긴 시각은 달력 시각으로 적는다("00:03"). 다음 날인지는 `nextDay`로 따로 알린다. */
function clockText(minute: number): string {
  const inDay = minute % DAY_MINUTES;
  return `${String(Math.floor(inDay / 60)).padStart(2, "0")}:${String(inDay % 60).padStart(2, "0")}`;
}

export type LastTrainTime = {
  kind: "direct" | "margin";
  /** 화면에 보이는 분(운행일의 분, 여유 시각은 10분 단위로 내린 값). */
  minute: number;
  /** "00:03" */
  clock: string;
  /** 달력으로는 다음 날(자정을 넘김). */
  nextDay: boolean;
  /** 갈아타는 길인가(여유 시각에서만 true일 수 있다). */
  transfer: boolean;
  /** 열차 한 대로 가는 길의 행선지 "광교행". 서버가 준 이름만 쓴다. 없으면 null. */
  bound: string | null;
};

/** 시각이 있는 항목만 화면 값으로. 확인 필요이거나 값이 모자라면 null. */
export function lastTrainTime(entry: LastTrainEntry | undefined): LastTrainTime | null {
  if (!entry || entry.kind === "check" || entry.minute === undefined) return null;
  const minute = shownMinute(entry.kind, entry.minute);
  return {
    kind: entry.kind,
    minute,
    clock: clockText(minute),
    nextDay: minute >= DAY_MINUTES,
    transfer: entry.kind === "margin" && entry.transfer === true,
    bound: entry.boundFor ? `${entry.boundFor.stationName}행` : null,
  };
}

export type LastTrainRow = {
  index: number;
  /** 서버 짧은 이름(shortLabel). */
  name: string;
  /** 시각이 있는 줄 / 확인 필요 / 출발역이 바로 그 역(돌아갈 길이 없다). */
  state: LastTrainTime | { kind: "check" } | { kind: "same" };
  /** 출발역을 숨긴 본인의 줄: 이 화면에만 있다(다른 사람 화면·미리보기에는 없다). */
  onlyMe: boolean;
  /** 카카오맵 대중교통 길찾기(만날 역 → 이 사람의 출발역). 좌표를 모르면 null. */
  mapUrl: string | null;
};

export type LastTrainView = {
  /** "강남역" */
  stationName: string;
  /** "평일" · "토요일" · "일요일·공휴일" */
  dayLabel: string;
  /** 가장 먼저 나서야 하는 사람 한 줄. 시각을 아는 공개 참가자가 없으면 null. */
  lead: string | null;
  rows: LastTrainRow[];
  /** 확인 필요 줄에 적는 짧은 이유(이 칸의 모든 확인 필요 줄이 같은 이유다). */
  checkReason: string;
  /** 이 요일 종류는 일부 노선만 계산했다는 한 줄. 일부만 계산한 요일 종류이고 시각이 빠진 줄이 있을 때만 있다. */
  partialNote: string | null;
  /** 출발역을 숨겨 이 화면에 줄이 없는 사람이 있다. */
  hiddenOthers: boolean;
  /** 맨 아래 공통 안내. */
  footnote: string;
};

function dayLabel(dayType: Basis["dayType"]): string {
  return DAY_TYPES.find((d) => d.id === dayType)?.label ?? dayType;
}

/** "2026-11-16" → "2026년 11월 16일". 모양이 다르면 그대로 둔다. */
function koreanDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return match ? `${match[1]}년 ${Number(match[2])}월 ${Number(match[3])}일` : date;
}

/**
 * 확인 필요의 이유. 응답 전체에 해당하는 이유(`unavailable`)가 먼저다. 그 밖에는 일부 노선만 계산한 토요일이면 그 사실을,
 * 아니면 이 길을 아직 계산하지 않는다고 말한다. 어느 노선 때문인지는 서버가 주지 않으므로 노선 이름을 적지 않는다.
 */
function checkReason(basis: Basis): string {
  if (basis.unavailable === "stale") return "시간표가 오래돼 확인이 필요해요.";
  if (basis.unavailable === "date_out_of_range") {
    return "이 날짜는 공휴일인지 아직 알 수 없어 막차를 보여 드리지 못해요.";
  }
  if (basis.unavailable === "day_unknown") return "약속 날짜가 없어 요일을 알 수 없어요. 요일마다 막차가 달라요.";
  return basis.partial && basis.dayType === "saturday"
    ? "이 길의 토요일 막차는 아직 준비 중이에요."
    : "이 길은 아직 막차를 계산하지 않아요.";
}

/** "23시" · "22:20" · "다음 날 00:03". 정각은 말하듯 적고, 그 밖에는 시계 숫자로 적는다("22시 20분 전"은 뜻이 둘로 읽힌다). */
function leaveByText(time: LastTrainTime): string {
  const inDay = time.minute % DAY_MINUTES;
  const text = inDay % 60 === 0 && !time.nextDay ? `${inDay / 60}시` : time.clock;
  return time.nextDay ? `다음 날 ${text}` : text;
}

/** 여유 시각 아래의 설명. 갈아타는 길과 열차 한 대로 가는 길(공식 시간표와 맞춰 보기 전)의 말이 다르다. */
export function marginNote(time: LastTrainTime): string {
  const tail = "실제 막차는 이보다 늦을 수 있어요.";
  if (time.transfer) return `갈아타는 길이라 넉넉히 일찍 잡았어요. ${tail}`;
  const train = time.bound ? `${time.bound} 열차 한 대로 가요.` : "열차 한 대로 가요.";
  return `${train} 시간표를 한 번 더 맞춰 보기 전이라 넉넉히 일찍 잡았어요. ${tail}`;
}

export type LastTrainPerson = {
  index: number;
  participantId: string;
  shortName: string;
  /** 출발역을 숨겼다. */
  hidden: boolean;
  /** 이 화면을 보는 본인(방의 내 토큰). */
  isSelf: boolean;
  originCode: string | null;
  /** 만날 역 → 이 사람의 출발역 길찾기. */
  mapUrl: string | null;
};

/**
 * 한 후보 역의 막차 칸. 기준(`lastTrainBasis`)이나 항목이 없으면 null(칸을 그리지 않는다: 막차 표가 없는 서버, 표를 읽는 중).
 * - 출발역을 숨긴 다른 사람은 줄이 없다(서버가 항목을 주지 않는다). 숨긴 본인의 줄은 본인 화면에만 있다.
 * - 맨 위 한 줄은 **출발역을 공개한 사람** 가운데 가장 이른 시각이다(숨긴 본인은 넣지 않는다: 사람마다 다른 말이 되지 않게).
 */
export function toLastTrainView(
  basis: Basis | undefined,
  entries: readonly (LastTrainEntry & { participantId: string })[] | undefined,
  station: { code: string; name: string },
  people: readonly LastTrainPerson[],
): LastTrainView | null {
  if (!basis || !entries) return null;
  const byId = new Map(entries.map((entry) => [entry.participantId, entry]));
  const rows = people.flatMap((person): LastTrainRow[] => {
    if (person.hidden && !person.isSelf) return [];
    const base = { index: person.index, name: person.shortName, onlyMe: person.hidden };
    if (person.originCode === station.code) return [{ ...base, state: { kind: "same" }, mapUrl: null }];
    const time = lastTrainTime(byId.get(person.participantId));
    return [{ ...base, state: time ?? { kind: "check" }, mapUrl: person.mapUrl }];
  });
  if (rows.length === 0) return null;
  const earliest = rows
    .filter((row) => !row.onlyMe)
    .flatMap((row) => (row.state.kind === "direct" || row.state.kind === "margin" ? [{ row, time: row.state }] : []))
    .reduce<{ row: LastTrainRow; time: LastTrainTime } | null>(
      (first, next) => (first === null || next.time.minute < first.time.minute ? next : first),
      null,
    );
  const day = dayLabel(basis.dayType);
  return {
    stationName: stationLabel(station.name),
    dayLabel: day,
    lead: earliest ? `${withJosa(earliest.row.name, "은/는")} ${leaveByText(earliest.time)} 전에 나서야 해요` : null,
    rows,
    checkReason: checkReason(basis),
    // 시각이 빠진 줄이 있을 때만 알린다(모두 시각이 있으면 이 말이 필요 없다).
    partialNote:
      basis.partial && rows.some((row) => row.state.kind === "check")
        ? `${withJosa(day, "은/는")} 일부 노선만 막차를 보여 드려요.`
        : null,
    hiddenOthers: people.some((person) => person.hidden && !person.isSelf),
    footnote: `${koreanDate(basis.asOf)} 시간표로 계산했어요. 공사나 행사가 있으면 달라질 수 있으니 타기 전에 한 번 더 확인해 주세요. 승강장까지 걷는 시간은 따로 잡아 주세요.`,
  };
}

/**
 * 공유 그림의 작은 줄: "막차 00:03"(직행 확정) 또는 "늦어도 23:00"(여유 시각). 시각이 없으면 null(줄을 비운다).
 * 낱말은 그림 글꼴 서브셋에 든 것(`OG_TEXT`)을 받아 쓴다.
 */
export function lastTrainCardLine(
  time: LastTrainTime | null,
  words: { lastTrain: string; lastTrainBy: string },
): string | null {
  if (!time) return null;
  return `${time.kind === "direct" ? words.lastTrain : words.lastTrainBy}${time.clock}`;
}
