/**
 * 부산권 화면 시안의 데이터. 수도권 역은 운영 역 인덱스, 부산권 역은 시안 픽스처(scripts/build-busan-draft-fixture.ts)에서 온다.
 * 시안 전용이며 운영 화면은 이 파일을 import하지 않는다.
 */
import { disassemble, getChoseong } from "es-hangul";
import { searchStations } from "@/lib/stations";
import { contrastRatio } from "@/lib/stations/badge-contrast";
import { SUPPORTED_LINES } from "@/lib/stations/coverage";
import raw from "./busan-stations.gen.json";

export type Region = "capital" | "busan";
export type DayType = "weekday" | "saturday" | "holiday";

export const REGION_NAME: Record<Region, string> = { capital: "수도권", busan: "부산권" };
export const DAY_NAME: Record<DayType, string> = { weekday: "평일", saturday: "토요일", holiday: "일요일·공휴일" };

export type DraftStation = {
  code: string;
  name: string;
  lines: string[];
  region: Region;
  supported: boolean;
  unsupportedDays: DayType[];
  geo: { lat: number; lng: number } | null;
};

type RawBusan = [string, string, string[], number, number, DayType[]];

const busan: DraftStation[] = (raw.stations as RawBusan[]).map(([code, name, lines, lat, lng, days]) => ({
  code,
  name,
  lines,
  region: "busan",
  supported: true,
  unsupportedDays: days,
  geo: { lat, lng },
}));

export const UNSUPPORTED_COUNT: Record<DayType, number> = {
  weekday: busan.filter((s) => s.unsupportedDays.includes("weekday")).length,
  saturday: busan.filter((s) => s.unsupportedDays.includes("saturday")).length,
  holiday: busan.filter((s) => s.unsupportedDays.includes("holiday")).length,
};

export type BusanLine = {
  label: string;
  color: string;
  /** 알약 배지 글자. */
  pill: string;
  /** 원 배지 글자(숫자 노선만). */
  circle: string | null;
  source: string;
  confirmed: boolean;
};

const WIKI = "위키백과 '틀:한국 철도 노선색'(2026-11-26 확인)";
/**
 * 부산 노선색. 운영사 공식 CI 문서의 hex 값은 찾지 못했다. 1~4호선은 부산시가 밝힌 색 이름(오렌지·그린·브라운·블루 라인)과
 * 위키백과 틀의 hex가 맞고, 부산김해경전철은 그 틀이 운영사 노선도에서 뽑은 값이다. 동해선은 위키 문서의 '코레일 블루'뿐이다.
 */
export const BUSAN_LINES: readonly BusanLine[] = [
  {
    label: "부산1호선",
    color: "#f06a00",
    pill: "부산1",
    circle: "1",
    source: `${WIKI}, 부산시 '오렌지 라인'`,
    confirmed: true,
  },
  {
    label: "부산2호선",
    color: "#81bf48",
    pill: "부산2",
    circle: "2",
    source: `${WIKI}, 부산시 '그린 라인'`,
    confirmed: true,
  },
  {
    label: "부산3호선",
    color: "#bb8c00",
    pill: "부산3",
    circle: "3",
    source: `${WIKI}, 부산시 '브라운 라인'`,
    confirmed: true,
  },
  {
    label: "부산4호선",
    color: "#217dcb",
    pill: "부산4",
    circle: "4",
    source: `${WIKI}, 부산시 '블루 라인'`,
    confirmed: true,
  },
  {
    label: "부산김해경전철",
    color: "#8652a1",
    pill: "김해",
    circle: null,
    source: `${WIKI}(운영사 노선도에서 추출했다고 적힘)`,
    confirmed: true,
  },
  {
    label: "동해선",
    color: "#0054a6",
    pill: "동해",
    circle: null,
    source: "알파위키·나무위키 '동해선 광역전철' 상징색(구 코레일 블루). 코레일 공식 값 미확인",
    confirmed: false,
  },
];
const busanLine = new Map(BUSAN_LINES.map((l) => [l.label, l]));
export const busanLineOf = (label: string): BusanLine | undefined => busanLine.get(label);

/** 작은 배지 글자색: 흰색·검정 중 4.5:1을 넘는 쪽(흰색 우선). */
export function badgeInk(color: string): string {
  return contrastRatio(color, "#ffffff") >= 4.5 ? "#ffffff" : "#16201b";
}

export const CAPITAL_LINE_COUNT = SUPPORTED_LINES.length;
export const BUSAN_LINE_LABELS = BUSAN_LINES.map((l) => l.label);

const busanIndex = busan.map((s) => ({ station: s, jamo: disassemble(s.name), choseong: getChoseong(s.name) }));

function searchBusan(query: string): DraftStation[] {
  const q = query.replace(/\s+/g, "").replace(/역$/, "");
  if (!q) return [];
  const jamo = disassemble(q);
  const scored = busanIndex
    .map(({ station, jamo: j, choseong }) => {
      if (station.name === q) return { station, score: 0 };
      if (j.startsWith(jamo)) return { station, score: 1 };
      if (/^[ㄱ-ㅎ]+$/.test(q) && choseong.startsWith(q)) return { station, score: 2 };
      if (station.name.includes(q)) return { station, score: 4 };
      return null;
    })
    .filter((x) => x !== null);
  return scored
    .sort((a, b) => a.score - b.score || a.station.name.length - b.station.name.length)
    .map((x) => x.station);
}

/** 수도권(운영 인덱스)과 부산권(픽스처)을 함께 찾는다. 같은 점수면 이름이 짧은 순. */
export function searchBoth(query: string, limit = 8): DraftStation[] {
  const capital: DraftStation[] = searchStations(query, limit).map((s) => ({
    ...s,
    region: "capital",
    unsupportedDays: [],
  }));
  const exact = (s: DraftStation) => (s.name === query.replace(/\s+|역$/g, "") ? 0 : 1);
  return [...capital, ...searchBusan(query)]
    .sort((a, b) => exact(a) - exact(b) || a.name.length - b.name.length || a.name.localeCompare(b.name, "ko"))
    .slice(0, limit);
}

export function stationNamed(name: string, region: Region, line?: string): DraftStation {
  const hit = searchBoth(name, 20).find(
    (s) => s.name === name && s.region === region && (line === undefined || s.lines.includes(line)),
  );
  if (!hit) throw new Error(`시안 픽스처에 없는 역: ${name}(${region})`);
  return hit;
}

function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const x = (b.lng - a.lng) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.sqrt(x * x + y * y) * 6_371_000;
}

/** 그 요일에 출발할 수 있는 가장 가까운 부산권 역(직선 `maxMeters` 안). */
export function nearestAvailable(
  station: DraftStation,
  day: DayType,
  maxMeters: number,
): { station: DraftStation; meters: number } | null {
  const from = station.geo;
  if (!from) return null;
  let best: { station: DraftStation; meters: number } | null = null;
  for (const s of busan) {
    if (s.code === station.code || !s.geo || s.unsupportedDays.includes(day)) continue;
    const meters = distanceMeters(from, s.geo);
    if (meters <= maxMeters && (!best || meters < best.meters)) best = { station: s, meters };
  }
  return best;
}
