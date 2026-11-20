/**
 * 가짜 서버의 추천 계산. **개발·e2e 전용**이며 실제 순위 규칙(shared/core)의 대체물이 아니다.
 * 웹 앱 번들에는 들어가지 않는다(src/ 밖). 시간은 역 좌표의 직선거리로 그럴듯하게 만든다.
 *
 * - 시간(초) = 대기 4분 + 거리 / 0.42km/분 + 환승마다 4분. 같은 역이면 0.
 * - 환승 = 노선을 공유하면 0, 아니면 1(18km 넘으면 2).
 * - 공평: (최장, 차이, 합계, 코드) / 빨리: (합계, 최장, 코드) / 배려: 공평 1위 대비 다른 사람 +min(15분, 50%) 상한 안에서
 *   우대 대상 시간이 짧은 순. 문장은 p6-notes 4.2 템플릿의 일부만 흉내 낸다.
 * - 구분(timeSlot): 대기를 구분마다 다르게 해(아침 −1분, 저녁 −30초, 밤 +3분, 토·휴일 +1분) 화면이 기준에 따라 바뀌는지 볼 수 있게 한다.
 *   응답의 timeBasis는 요청한 구분 그대로다.
 * - 표시 이름(label)은 실제 규칙(contracts/data-format.md §8, shared/app-logic)을 흉내 내지 않는다. 받은 이름이 있으면 그 이름,
 *   없으면 "참가자 N"이다. 웹은 label을 그대로 쓰므로 규칙이 어떻든 화면 동작은 같다.
 */
import type { components } from "../src/lib/api/schema.gen.ts";
import { withJosa } from "../src/lib/display/korean.ts";
import { formatMinutes, minutesFromSeconds } from "../src/lib/display/minutes.ts";
import { DEFAULT_SLOT, slotLabel, splitSlot, type TimeSlot } from "../src/lib/when/time-slot.ts";

type Result = components["schemas"]["Result"];
type Candidate = components["schemas"]["Candidate"];
type Mode = components["schemas"]["Mode"];

export type MockStation = { code: string; name: string; lines: string[]; lat: number; lng: number };
export type MockData = { origins: Map<string, MockStation>; candidates: MockStation[]; dataVersion: string };
export type RecommendBody = {
  origins: string[];
  mode: Mode;
  favorIndex?: number;
  nicknames?: (string | null)[];
  timeSlot?: TimeSlot;
};

const WAIT = 240;
const BAND_WAIT = { morning: -60, day: 0, evening: -30, night: 180 } as const;

function waitFor(slot: TimeSlot): number {
  const { day, band } = splitSlot(slot);
  return WAIT + BAND_WAIT[band] + (day === "weekday" ? 0 : 60);
}
const TRANSFER = 240;

function km(a: MockStation, b: MockStation): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

function travel(from: MockStation, to: MockStation, wait: number): { seconds: number; transfers: number } {
  if (from.code === to.code) return { seconds: 0, transfers: 0 };
  const distance = km(from, to);
  const shared = from.lines.some((line) => to.lines.includes(line));
  const transfers = shared ? 0 : distance > 18 ? 2 : 1;
  return { seconds: Math.round(wait + (distance / 0.42) * 60 + transfers * TRANSFER), transfers };
}

type Row = {
  station: MockStation;
  times: { seconds: number; transfers: number }[];
  max: number;
  spread: number;
  total: number;
};

function row(station: MockStation, people: MockStation[], wait: number): Row {
  const times = people.map((p) => travel(p, station, wait));
  const seconds = times.map((t) => t.seconds);
  const max = Math.max(...seconds);
  return { station, times, max, spread: max - Math.min(...seconds), total: seconds.reduce((a, b) => a + b, 0) };
}

const byCode = (a: Row, b: Row) => (a.station.code < b.station.code ? -1 : 1);
const fairOrder = (a: Row, b: Row) => a.max - b.max || a.spread - b.spread || a.total - b.total || byCode(a, b);
const fastOrder = (a: Row, b: Row) => a.total - b.total || a.max - b.max || byCode(a, b);

function cap(seconds: number): number {
  return seconds + Math.min(900, Math.floor(seconds / 2));
}

function rank(rows: Row[], mode: Mode, favorIndex: number): { ranked: Row[]; baseline: Row | undefined } {
  const fair = [...rows].sort(fairOrder);
  const baseline = fair[0];
  if (mode === "fair") return { ranked: fair, baseline };
  if (mode === "fast") return { ranked: [...rows].sort(fastOrder), baseline };
  const limits = baseline?.times.map((t) => cap(t.seconds)) ?? [];
  const allowed = rows.filter((r) => r.times.every((t, i) => i === favorIndex || t.seconds <= (limits[i] ?? 0)));
  const favored = (r: Row) => r.times[favorIndex]?.seconds ?? 0;
  return { ranked: allowed.sort((a, b) => favored(a) - favored(b) || fairOrder(a, b)), baseline };
}

function longest(names: string[], minutes: number[]): string {
  const max = Math.max(...minutes);
  return names.filter((_, i) => minutes[i] === max).join("·");
}

function reason(mode: Mode, r: Row, index: number, ranked: Row[], names: string[], favorIndex: number): string {
  const minutes = r.times.map((t) => minutesFromSeconds(t.seconds));
  const max = Math.max(...minutes);
  const first = ranked[0];
  if (max === 0) return "이미 같은 동네예요.";
  if (mode === "fair") {
    if (index > 0 && first) {
      const delta = max - Math.max(...first.times.map((t) => minutesFromSeconds(t.seconds)));
      return delta > 0
        ? `공평 모드 대안이에요. 1위 ${first.station.name}보다 가장 오래 걸리는 사람이 ${formatMinutes(delta)} 더 걸려요.`
        : `공평 모드 대안이에요. 1위 ${withJosa(first.station.name, "과/와")} 최장 시간은 같아요.`;
    }
    const lead = `가장 오래 걸리는 ${longest(names, minutes)}도 ${formatMinutes(max)}이에요.`;
    const second = ranked[1];
    if (!second) return lead;
    const delta = Math.max(...second.times.map((t) => minutesFromSeconds(t.seconds))) - max;
    return delta > 0
      ? `${lead} 2위 ${second.station.name}보다 가장 오래 걸리는 사람이 ${formatMinutes(delta)} 덜 걸려요.`
      : `${lead} 2위 ${withJosa(second.station.name, "과/와")} 최장 시간은 같지만, 시간 차이가 더 작아요.`;
  }
  const total = minutes.reduce((a, b) => a + b, 0);
  if (mode === "fast") {
    if (index > 0 && first) {
      const delta = total - first.times.reduce((a, t) => a + minutesFromSeconds(t.seconds), 0);
      return `빠른 만남 대안이에요. 1위 ${first.station.name}보다 합쳐서 ${formatMinutes(Math.max(delta, 0))} 더 걸려요.`;
    }
    const group = names.length === 2 ? "둘이" : `${names.length}명 모두`;
    return `${group} 합쳐 ${formatMinutes(total)}, 후보 중 가장 짧아요. 가장 오래 걸리는 ${withJosa(longest(names, minutes), "은/는")} ${formatMinutes(max)}이에요.`;
  }
  const name = names[favorIndex] ?? "";
  const mine = r.times[favorIndex];
  if (!mine) return "";
  if (index > 0 && first) {
    return `${name} 쪽 대안이에요. 1위 ${first.station.name}보다 ${withJosa(name, "은/는")} ${formatMinutes(minutesFromSeconds(mine.seconds))} 걸려요.`;
  }
  const how = mine.transfers === 0 ? "환승 없이 와요." : `환승 ${mine.transfers}번으로 와요.`;
  return `${withJosa(name, "은/는")} ${formatMinutes(minutesFromSeconds(mine.seconds))}, ${how}`;
}

/**
 * "지도 한가운데" 역(#68): 출발역 좌표 평균(경도는 cos 위도로 보정)에 가장 가까운 후보. 같은 거리면 코드 순.
 * 공평 기준에서 1위와 다르고 가장 오래 걸리는 시간이 5분(표시 분) 이상 늘 때만 준다. 서버의 `MapMiddleRule`을 흉내 낸 것이다.
 */
function mapMiddle(rows: Row[], people: MockStation[], first: Row | undefined): Result["mapMiddle"] {
  if (!first || people.length === 0) return undefined;
  const lat = people.reduce((sum, p) => sum + p.lat, 0) / people.length;
  const lng = people.reduce((sum, p) => sum + p.lng, 0) / people.length;
  const squeeze = Math.cos((lat * Math.PI) / 180);
  const distance = (r: Row) => Math.hypot(r.station.lat - lat, (r.station.lng - lng) * squeeze);
  const nearest = rows.reduce<Row | undefined>(
    (best, r) =>
      !best || distance(r) < distance(best) || (distance(r) === distance(best) && r.station.code < best.station.code)
        ? r
        : best,
    undefined,
  );
  if (!nearest || nearest.station.code === first.station.code) return undefined;
  const extra = minutesFromSeconds(nearest.max) - minutesFromSeconds(first.max);
  if (extra < 5) return undefined;
  return {
    stationCode: nearest.station.code,
    stationName: nearest.station.name,
    times: nearest.times.map((t, p) => ({ participantId: String(p), seconds: t.seconds, transfers: t.transfers })),
  };
}

const REASON_CODES: Record<Mode, [Candidate["reasonCode"], Candidate["reasonCode"]]> = {
  fair: ["FAIR_MINIMAX", "FAIR_ALTERNATIVE"],
  fast: ["FAST_TOTAL", "FAST_ALTERNATIVE"],
  favor: ["FAVOR_CAPPED", "FAVOR_ALTERNATIVE"],
};

const LAST_TRAIN_AS_OF = "2026-11-16";
/** 요일 종류별 가짜 막차 기준 시각(운행일의 분). 평일이 가장 늦다. */
const LAST_TRAIN_BASE = { weekday: 24 * 60 + 25, saturday: 23 * 60 + 52, holiday: 23 * 60 + 41 } as const;

/**
 * 가짜 "집에 가는 막차"(#62). **실제 시간표가 아니다.** 화면의 세 가지 모양을 고르게 볼 수 있게 노선과 거리로 꾸민다.
 * - 구분 없이 온 요청(옛 `v=1` 링크): 모두 확인 필요, 기준에 `day_unknown`.
 * - 만날 역과 같은 노선: 열차 한 대(9호선은 여유 시각, 그 밖은 직행 확정), 행선지는 그 사람의 출발역.
 * - 다른 노선: 갈아타는 여유 시각(10분 단위가 아닌 분: 화면이 내려 보이는지 볼 수 있게). 30km가 넘으면 확인 필요.
 * - 토요일: 일부 노선만 계산한 요일 종류(`partial`)이고, 갈아타는 길은 확인 필요.
 */
function lastTrains(r: Row, people: MockStation[], slot: TimeSlot | undefined): NonNullable<Candidate["lastTrains"]> {
  return people.map((home, p) => {
    const participantId = String(p);
    const time = r.times[p];
    if (!slot || !time || home.code === r.station.code) return { participantId, kind: "check" as const };
    const day = splitSlot(slot).day;
    const ride = minutesFromSeconds(time.seconds);
    const line = home.lines.find((name) => r.station.lines.includes(name));
    if (line) {
      const minute = LAST_TRAIN_BASE[day] - Math.floor(ride / 3);
      const boundFor = { stationCode: home.code, stationName: home.name };
      return line.includes("9호선")
        ? { participantId, kind: "margin" as const, minute: minute - 3, transfer: false, boundFor }
        : { participantId, kind: "direct" as const, minute, boundFor };
    }
    if (day === "saturday" || km(home, r.station) > 30) return { participantId, kind: "check" as const };
    return {
      participantId,
      kind: "margin" as const,
      minute: LAST_TRAIN_BASE[day] - 47 - Math.floor(ride / 2),
      transfer: true,
    };
  });
}

function lastTrainBasis(slot: TimeSlot | undefined): NonNullable<Result["lastTrainBasis"]> {
  if (!slot) return { dayType: "weekday", asOf: LAST_TRAIN_AS_OF, unavailable: "day_unknown" };
  const dayType = splitSlot(slot).day;
  return { dayType, asOf: LAST_TRAIN_AS_OF, ...(dayType === "saturday" ? { partial: true } : {}) };
}

/** 계약의 `POST /v1/recommend` 응답을 만든다. 입력 검증은 호출하는 쪽(server.ts)이 한다. */
export function mockRecommend(data: MockData, body: RecommendBody): Result {
  const people = body.origins.map((code) => data.origins.get(code)).filter((s): s is MockStation => s !== undefined);
  const favorIndex = body.mode === "favor" ? (body.favorIndex ?? 0) : -1;
  const nicknames = people.map((_, i) => body.nicknames?.[i]?.trim() || null);
  const names = nicknames.map((name, i) => name ?? `참가자 ${i + 1}`);
  const slot = body.timeSlot ?? DEFAULT_SLOT;
  const rows = data.candidates.map((c) => row(c, people, waitFor(slot))).filter((r) => r.max <= 4 * 3600);
  const { ranked, baseline } = rank(rows, body.mode, favorIndex);
  const top = ranked.slice(0, 3);
  const [firstCode, restCode] = REASON_CODES[body.mode];
  const middle = body.mode === "fair" ? mapMiddle(rows, people, top[0]) : undefined;
  return {
    status: top.length === 0 ? "no_common_candidate" : "ok",
    mode: body.mode,
    dataVersion: data.dataVersion,
    participants: people.map((p, i) => ({
      participantId: String(i),
      nickname: nicknames[i] ?? null,
      hidden: false,
      originCode: p.code,
      originName: p.name,
      label: names[i] ?? "",
      labelKind: nicknames[i] ? ("name" as const) : ("ordinal" as const),
      shortLabel: names[i] ?? "",
    })),
    baselineStationCode: baseline?.station.code ?? null,
    ...(middle ? { mapMiddle: middle } : {}),
    timeBasis: {
      timeSlot: slot,
      requestedTimeSlot: slot,
      dayType: splitSlot(slot).day,
      band: splitSlot(slot).band,
      label: slotLabel(slot),
      holidayName: null,
    },
    lastTrainBasis: lastTrainBasis(body.timeSlot),
    candidates: top.map((r, i) => ({
      rank: i + 1,
      stationCode: r.station.code,
      stationName: r.station.name,
      times: r.times.map((t, p) => ({ participantId: String(p), seconds: t.seconds, transfers: t.transfers })),
      maxSeconds: r.max,
      spreadSeconds: r.spread,
      totalSeconds: r.total,
      ...(favorIndex >= 0 ? { favoredSeconds: r.times[favorIndex]?.seconds ?? 0 } : {}),
      reasonCode: i === 0 ? firstCode : restCode,
      reason: reason(body.mode, r, i, top, names, favorIndex),
      lastTrains: lastTrains(r, people, body.timeSlot),
    })),
  };
}
