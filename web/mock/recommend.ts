/**
 * 가짜 서버의 추천 계산. **개발·e2e 전용**이며 실제 순위 규칙(shared/core)의 대체물이 아니다.
 * 웹 앱 번들에는 들어가지 않는다(src/ 밖). 시간은 역 좌표의 직선거리로 그럴듯하게 만든다.
 *
 * - 시간(초) = 대기 4분 + 거리 / 0.42km/분 + 환승마다 4분. 같은 역이면 0.
 * - 환승 = 노선을 공유하면 0, 아니면 1(18km 넘으면 2).
 * - 공평: (최장, 차이, 합계, 코드) / 빨리: (합계, 최장, 코드) / 배려: 공평 1위 대비 다른 사람 +min(15분, 50%) 상한 안에서
 *   우대 대상 시간이 짧은 순. 문장은 p6-notes 4.2 템플릿의 일부만 흉내 낸다.
 */
import type { components } from "../src/lib/api/schema.gen.ts";
import { withJosa } from "../src/lib/display/korean.ts";
import { formatMinutes, minutesFromSeconds } from "../src/lib/display/minutes.ts";
import { DEFAULT_NAMES } from "../src/lib/display/names.ts";

type Result = components["schemas"]["Result"];
type Candidate = components["schemas"]["Candidate"];
type Mode = components["schemas"]["Mode"];

export type MockStation = { code: string; name: string; lines: string[]; lat: number; lng: number };
export type MockData = { origins: Map<string, MockStation>; candidates: MockStation[]; dataVersion: string };
export type RecommendBody = { origins: string[]; mode: Mode; favorIndex?: number };

const WAIT = 240;
const TRANSFER = 240;

function km(a: MockStation, b: MockStation): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

function travel(from: MockStation, to: MockStation): { seconds: number; transfers: number } {
  if (from.code === to.code) return { seconds: 0, transfers: 0 };
  const distance = km(from, to);
  const shared = from.lines.some((line) => to.lines.includes(line));
  const transfers = shared ? 0 : distance > 18 ? 2 : 1;
  return { seconds: Math.round(WAIT + (distance / 0.42) * 60 + transfers * TRANSFER), transfers };
}

type Row = {
  station: MockStation;
  times: { seconds: number; transfers: number }[];
  max: number;
  spread: number;
  total: number;
};

function row(station: MockStation, people: MockStation[]): Row {
  const times = people.map((p) => travel(p, station));
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

const REASON_CODES: Record<Mode, [Candidate["reasonCode"], Candidate["reasonCode"]]> = {
  fair: ["FAIR_MINIMAX", "FAIR_ALTERNATIVE"],
  fast: ["FAST_TOTAL", "FAST_ALTERNATIVE"],
  favor: ["FAVOR_CAPPED", "FAVOR_ALTERNATIVE"],
};

/** 계약의 `POST /v1/recommend` 응답을 만든다. 입력 검증은 호출하는 쪽(server.ts)이 한다. */
export function mockRecommend(data: MockData, body: RecommendBody): Result {
  const people = body.origins.map((code) => data.origins.get(code)).filter((s): s is MockStation => s !== undefined);
  const favorIndex = body.mode === "favor" ? (body.favorIndex ?? 0) : -1;
  // 서버는 /recommend에서 별칭을 모른다. 문장은 기본 이름("나/친구1…")으로 만든다.
  const names = people.map((_, i) => DEFAULT_NAMES[i] ?? `친구${i}`);
  const rows = data.candidates.map((c) => row(c, people)).filter((r) => r.max <= 4 * 3600);
  const { ranked, baseline } = rank(rows, body.mode, favorIndex);
  const top = ranked.slice(0, 3);
  const [firstCode, restCode] = REASON_CODES[body.mode];
  return {
    status: top.length === 0 ? "no_common_candidate" : "ok",
    mode: body.mode,
    dataVersion: data.dataVersion,
    participants: people.map((p, i) => ({
      participantId: String(i),
      nickname: null,
      hidden: false,
      originCode: p.code,
      originName: p.name,
    })),
    baselineStationCode: baseline?.station.code ?? null,
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
    })),
  };
}
