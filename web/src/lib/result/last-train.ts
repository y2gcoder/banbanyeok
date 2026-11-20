/**
 * "집에 가는 막차"(#62)를 화면 값으로 바꾼다. 서버는 값과 분류만 준다(`Candidate.lastTrains`, `Result.lastTrainBasis`):
 * 직행 확정(`direct`)은 분 그대로, 여유 시각(`margin`)은 **10분 단위로 내려** 보이고, 확인 필요(`check`)는 시각 없이 이유만 말한다.
 * 계산·순위는 하지 않는다. 문구는 모두 여기서 만든다(화면·공유 그림이 같은 말을 쓰고, 쓰지 않는 말 검사를 한 곳에서 한다).
 *
 * 시각은 만날 역에서 열차를 타는 시각이고 **운행일의 분**이다(03:00에 운행일이 바뀐다): 1390 = 23:10, 1443 = 다음 날 00:03.
 * 약속 날짜·시각을 알면(방) 실제 달력 날짜로 옮겨 본다: 03:00 전 약속은 전날 운행일이라, 그 밤 막차가 약속보다 먼저 떠날 수 있다.
 * 그런 열차는 귀가 시각으로 보이지 않고 "약속 전에 떠나요"로 알린다(화면의 줄·맨 위 한 줄·공유 그림 모두 같은 기준).
 */
import type { RecommendResult } from "@/lib/api/types";
import { stationLabel, withJosa } from "@/lib/display/korean";
import { dayAfter, formatMeetingDate } from "@/lib/room/dates";
import { DAY_TYPES } from "@/lib/when/time-slot";

type Basis = NonNullable<RecommendResult["lastTrainBasis"]>;
/** 방 미리보기의 항목(`PreviewTime.lastTrain`)도 같은 모양이다(참가자 ID만 없다). */
export type LastTrainEntry = Pick<
  NonNullable<RecommendResult["candidates"][number]["lastTrains"]>[number],
  "kind" | "minute" | "transfer" | "boundFor"
>;

/** 방의 약속(`Room.meetingDate`·`meetingTime`). 혼자 입력한 결과에는 날짜가 없다(둘 다 없으면 약속을 모르는 것으로 본다). */
export type MeetingWhen = { date?: string | null | undefined; time?: string | null | undefined };

const DAY_MINUTES = 24 * 60;
const MARGIN_STEP = 10;
/** 운행일이 바뀌는 시각(contracts/time-slots.json rules). 이 전의 약속은 전날 운행일의 밤이다. */
const SERVICE_DAY_START = "03:00";

/** 화면에 보이는 분. 여유 시각만 10분 단위로 내린다(올림·반올림은 하지 않는다). */
function shownMinute(kind: "direct" | "margin", minute: number): number {
  return kind === "direct" ? minute : minute - (minute % MARGIN_STEP);
}

/** "23:10". 자정을 넘긴 시각은 달력 시각으로 적는다("00:03"). 다음 날인지는 `nextDay`로 따로 알린다. */
function clockText(minute: number): string {
  const inDay = minute % DAY_MINUTES;
  return `${String(Math.floor(inDay / 60)).padStart(2, "0")}:${String(inDay % 60).padStart(2, "0")}`;
}

/** 약속의 운행일(`YYYY-MM-DD`)과 그 운행일의 분으로 본 약속 시각. 날짜를 모르면 null, 시각을 모르면 분만 null. */
function serviceDayOf(meeting: MeetingWhen | undefined): { date: string; meetingMinute: number | null } | null {
  if (!meeting?.date) return null;
  if (!meeting.time) return { date: meeting.date, meetingMinute: null };
  const [hour = 0, minute = 0] = meeting.time.split(":").map(Number);
  const early = meeting.time < SERVICE_DAY_START;
  return {
    date: early ? dayAfter(meeting.date, -1) : meeting.date,
    meetingMinute: hour * 60 + minute + (early ? DAY_MINUTES : 0),
  };
}

export type LastTrainTime = {
  kind: "direct" | "margin";
  /** 화면에 보이는 분(운행일의 분, 여유 시각은 10분 단위로 내린 값). */
  minute: number;
  /** "00:03" */
  clock: string;
  /** 약속일(날짜를 모르면 운행일)의 다음 날에 떠난다. 새벽 약속의 그날 새벽 열차는 약속일과 같은 날이라 false다. */
  nextDay: boolean;
  /** 갈아타는 길인가(여유 시각에서만 true일 수 있다). */
  transfer: boolean;
  /** 열차 한 대로 가는 길의 행선지 "광교행". 서버가 준 이름만 쓴다. 없으면 null. */
  bound: string | null;
};

/** 약속 시각보다 먼저 떠나는 열차: 귀가 시각으로 보이지 않고 이 말만 한다. */
export type LastTrainGone = {
  kind: "gone";
  /** 서버 분류. 직행 확정이면 막차가 약속 전에 떠난다고 말할 수 있고, 여유 시각이면 "이를 수 있다"까지만 말한다. */
  source: "direct" | "margin";
  /** "11월 28일 00:27 막차는 약속 전에 떠나요." */
  text: string;
};

function goneText(source: "direct" | "margin", when: string): string {
  return source === "direct"
    ? `${when} 막차는 약속 전에 떠나요.`
    : `넉넉히 잡으면 ${when}엔 떠나야 해서 약속 시각보다 일러요. 실제 막차는 이보다 늦을 수 있어요.`;
}

/**
 * 시각이 있는 항목을 화면 값으로. 확인 필요이거나 값이 모자라면 null.
 * 약속 날짜·시각을 알고 보이는 시각이 약속보다 이르면 `gone`이다(약속과 같은 분은 아직 탈 수 있는 열차로 둔다).
 */
export function lastTrainState(
  entry: LastTrainEntry | undefined,
  meeting?: MeetingWhen,
): LastTrainTime | LastTrainGone | null {
  if (!entry || entry.kind === "check" || entry.minute === undefined) return null;
  const minute = shownMinute(entry.kind, entry.minute);
  const clock = clockText(minute);
  const service = serviceDayOf(meeting);
  const departs = service ? dayAfter(service.date, Math.floor(minute / DAY_MINUTES)) : null;
  if (service && departs && service.meetingMinute !== null && minute < service.meetingMinute) {
    return { kind: "gone", source: entry.kind, text: goneText(entry.kind, `${formatMeetingDate(departs)} ${clock}`) };
  }
  return {
    kind: entry.kind,
    minute,
    clock,
    nextDay: departs && meeting?.date ? departs > meeting.date : minute >= DAY_MINUTES,
    transfer: entry.kind === "margin" && entry.transfer === true,
    bound: entry.boundFor ? `${entry.boundFor.stationName}행` : null,
  };
}

export type LastTrainRow = {
  index: number;
  /** 서버 짧은 이름(shortLabel). */
  name: string;
  /** 시각이 있는 줄 / 약속 전에 떠남 / 확인 필요 / 출발역이 바로 그 역(돌아갈 길이 없다). */
  state: LastTrainTime | LastTrainGone | { kind: "check" } | { kind: "same" };
  /** 출발역을 숨긴 본인의 줄: 이 화면에만 있다(다른 사람 화면·미리보기에는 없다). */
  onlyMe: boolean;
  /** 카카오맵 대중교통 길찾기(만날 역 → 이 사람의 출발역). 좌표를 모르면 null. */
  mapUrl: string | null;
};

export type LastTrainView = {
  /** "강남역" */
  stationName: string;
  /** "평일" · "토요일" · "일요일·공휴일". 계산하지 못한 응답(요일을 모름·공휴일 미확정·오래된 시간표)과 줄이 없는 칸은 null. */
  dayLabel: string | null;
  /** 계산하지 못한 이유(응답 전체). 있으면 맨 위에 이 말을 먼저 보이고 시각·요일·일부 노선 안내는 없다. */
  notice: string | null;
  /** 맨 위 한 줄: 공개된 시각 가운데 가장 이른 것, 또는 약속 전에 막차가 떠나는 사람이 있다는 말. 없으면 null. */
  lead: string | null;
  rows: LastTrainRow[];
  /** 확인 필요 줄에 적는 짧은 이유(이 칸의 모든 확인 필요 줄이 같은 이유다). 이유를 맨 위(`notice`)에서 말했으면 null. */
  checkReason: string | null;
  /** 이 요일 종류는 일부 노선만 계산했다는 한 줄. 요일을 알고 계산한 응답이 `partial`이면 줄의 종류와 상관없이 있다. */
  partialNote: string | null;
  /** 출발역을 숨겨 이 화면에 줄이 없는 사람이 있다. */
  hiddenOthers: boolean;
  /** 맨 아래 공통 안내(시간표 수집 기준일). 줄이 없는 칸은 null. */
  footnote: string | null;
};

function dayLabel(dayType: Basis["dayType"]): string {
  return DAY_TYPES.find((d) => d.id === dayType)?.label ?? dayType;
}

/** "2026-11-16" → "2026년 11월 16일". 모양이 다르면 그대로 둔다. */
function koreanDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return match ? `${match[1]}년 ${Number(match[2])}월 ${Number(match[3])}일` : date;
}

/** 응답 전체를 계산하지 못한 이유. 계산한 응답이면 null. */
function unavailableNotice(basis: Basis): string | null {
  if (basis.unavailable === "stale") return "시간표가 오래돼 막차를 보여 드리지 못해요.";
  if (basis.unavailable === "date_out_of_range") {
    return "이 날짜는 공휴일인지 아직 알 수 없어 막차를 보여 드리지 못해요.";
  }
  if (basis.unavailable === "day_unknown") {
    return "약속 날짜가 없어 요일을 알 수 없어요. 요일마다 막차가 달라 보여 드리지 못해요.";
  }
  return null;
}

/**
 * 계산한 응답에서 확인 필요인 줄의 이유. 일부 노선만 계산한 토요일이면 그 사실을, 아니면 이 길을 아직 계산하지 않는다고 말한다.
 * 어느 노선 때문인지는 서버가 주지 않으므로 노선 이름을 적지 않는다.
 */
function checkReason(basis: Basis): string {
  return basis.partial && basis.dayType === "saturday"
    ? "이 길의 토요일 막차는 아직 준비 중이에요."
    : "이 길은 아직 막차를 계산하지 않아요.";
}

/** "다음 날 00:03" · "23:40". */
function clockWithDay(time: LastTrainTime): string {
  return time.nextDay ? `다음 날 ${time.clock}` : time.clock;
}

/** "23시" · "22:20" · "다음 날 00:03". 정각은 말하듯 적고, 그 밖에는 시계 숫자로 적는다("22시 20분 전"은 뜻이 둘로 읽힌다). */
function leaveByText(time: LastTrainTime): string {
  const inDay = time.minute % DAY_MINUTES;
  return inDay % 60 === 0 && !time.nextDay ? `${inDay / 60}시` : clockWithDay(time);
}

/**
 * 맨 위 한 줄. **출발역을 공개한 사람**의 줄만 본다(숨긴 본인의 값은 넣지 않는다: 사람마다 다른 말이 되지 않게).
 * - 약속 전에 떠나는 줄이 있으면 그 사실이 먼저다(가장 이른 시각을 귀가 시각처럼 말하지 않는다).
 * - 확인 필요인 줄이 섞여 있으면 "공개된 시각 중에는"으로 범위를 밝힌다. 모두 시각이 있을 때만 "○○은 23시 전에 나서야 해요"다.
 */
function leadText(rows: readonly LastTrainRow[]): string | null {
  const open = rows.filter((row) => !row.onlyMe);
  const gone = open.flatMap((row) => (row.state.kind === "gone" ? [row.state] : []));
  if (gone.some((state) => state.source === "direct")) return "약속 전에 막차가 떠나는 분이 있어요.";
  if (gone.length > 0) return "막차가 약속 시각보다 이를 수 있는 분이 있어요.";
  const earliest = open
    .flatMap((row) => (row.state.kind === "direct" || row.state.kind === "margin" ? [{ row, time: row.state }] : []))
    .reduce<{ row: LastTrainRow; time: LastTrainTime } | null>(
      (first, next) => (first === null || next.time.minute < first.time.minute ? next : first),
      null,
    );
  if (!earliest) return null;
  if (open.some((row) => row.state.kind === "check")) {
    const clock = withJosa(clockWithDay(earliest.time), "이/가");
    return `공개된 시각 중에는 ${earliest.row.name}의 ${clock} 가장 일러요. 막차를 더 확인해야 할 분도 있어요.`;
  }
  return `${withJosa(earliest.row.name, "은/는")} ${leaveByText(earliest.time)} 전에 나서야 해요`;
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
 * - 모두가 숨긴 방을 본인이 아닌 사람이 보면 줄이 하나도 없다. 그때도 칸은 두고 "본인 화면에서만 보여요"만 말한다.
 * - `meeting`은 방의 약속이다. 있으면 약속보다 먼저 떠나는 열차를 가려낸다(`lastTrainState`).
 */
export function toLastTrainView(
  basis: Basis | undefined,
  entries: readonly (LastTrainEntry & { participantId: string })[] | undefined,
  station: { code: string; name: string },
  people: readonly LastTrainPerson[],
  meeting?: MeetingWhen,
): LastTrainView | null {
  if (!basis || !entries) return null;
  const byId = new Map(entries.map((entry) => [entry.participantId, entry]));
  const rows = people.flatMap((person): LastTrainRow[] => {
    if (person.hidden && !person.isSelf) return [];
    const base = { index: person.index, name: person.shortName, onlyMe: person.hidden };
    if (person.originCode === station.code) return [{ ...base, state: { kind: "same" }, mapUrl: null }];
    const state = lastTrainState(byId.get(person.participantId), meeting);
    return [{ ...base, state: state ?? { kind: "check" }, mapUrl: person.mapUrl }];
  });
  const hiddenOthers = people.some((person) => person.hidden && !person.isSelf);
  const stationName = stationLabel(station.name);
  if (rows.length === 0) {
    if (!hiddenOthers) return null;
    return {
      stationName,
      dayLabel: null,
      notice: null,
      lead: null,
      rows,
      checkReason: null,
      partialNote: null,
      hiddenOthers,
      footnote: null,
    };
  }
  const collected = `시간표 수집 기준 ${koreanDate(basis.asOf)}.`;
  const notice = unavailableNotice(basis);
  if (notice) {
    // 계산하지 못한 응답: 이유를 앞세우고, 쓰지 않은 요일·일부 노선·"계산했어요"는 말하지 않는다.
    return {
      stationName,
      dayLabel: null,
      notice,
      lead: null,
      rows,
      checkReason: null,
      partialNote: null,
      hiddenOthers,
      footnote: collected,
    };
  }
  const day = dayLabel(basis.dayType);
  return {
    stationName,
    dayLabel: day,
    notice: null,
    lead: leadText(rows),
    rows,
    checkReason: checkReason(basis),
    partialNote: basis.partial ? `${withJosa(day, "은/는")} 일부 노선만 막차를 보여 드려요.` : null,
    hiddenOthers,
    footnote: `${collected} 공사나 행사가 있으면 달라질 수 있으니 타기 전에 한 번 더 확인해 주세요. 승강장까지 걷는 시간은 따로 잡아 주세요.`,
  };
}

/**
 * 공유 그림의 작은 줄: "막차 23:52"(직행 확정), "늦어도 23:00"(여유 시각), 자정을 넘기면 "막차 다음 날 00:03".
 * 시각이 없거나 약속 전에 떠나는 열차면 null(줄을 비운다). 낱말은 그림 글꼴 서브셋에 든 것(`OG_TEXT`)을 받아 쓴다.
 */
export function lastTrainCardLine(
  state: LastTrainTime | LastTrainGone | null,
  words: { lastTrain: string; lastTrainBy: string; nextDay: string },
): string | null {
  if (!state || state.kind === "gone") return null;
  return `${state.kind === "direct" ? words.lastTrain : words.lastTrainBy}${state.nextDay ? words.nextDay : ""}${state.clock}`;
}
