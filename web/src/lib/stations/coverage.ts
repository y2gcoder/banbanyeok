/**
 * 계산 범위(#170). 첫 화면의 "수도권 전철 N개 노선"과 역 검색의 "계산하지 않는 역" 안내가 여기서 나온다.
 * 노선 목록·개수·빠진 곳은 역 인덱스(index.gen.json)의 lines·supported에서 계산한다(손으로 적지 않는다).
 * 계산하지 않는 이유 문구는 아래 표 한 곳에만 둔다. 표의 각 줄은 범위를 정한 원본 data/config/tago-scope.json의
 * excludedStations·excludedRoutes 항목(`tago` 키)에 대응하며, coverage.test.ts가 그 키가 원본에 있는지와 계산하지 않는 역마다
 * 이유가 있는지를 본다.
 */

import type { Station } from "./index";
import raw from "./index.gen.json";
import { isCapitalAreaLine } from "./lines";

type RawStation = [string, string, number[], string[], number, ...number[]];
const rawStations = raw.stations as RawStation[];

/** 숫자 노선(1~9호선)을 번호순으로 먼저, 나머지는 가나다순. */
function lineNumber(label: string): number {
  const m = /^(\d)호선$/.exec(label);
  return m?.[1] ? Number(m[1]) : 10;
}
const byLineOrder = (a: string, b: string) => lineNumber(a) - lineNumber(b) || a.localeCompare(b, "ko");

function computeSupportedLines(): string[] {
  const used = new Set<number>();
  for (const [, , lineIdx, , supported] of rawStations) {
    if (supported === 1) for (const i of lineIdx) used.add(i);
  }
  return [...used]
    .map((i) => raw.lines[i] ?? "")
    .filter(Boolean)
    .sort(byLineOrder);
}

/** 출발역으로 계산할 수 있는 역이 하나라도 있는 노선. 숫자 노선 먼저, 나머지는 가나다순. */
export const SUPPORTED_LINES: readonly string[] = computeSupportedLines();

/**
 * 범위에서 빠진 곳: 계산할 수 있는 역이 하나도 없는 노선은 노선 이름으로, 일부 역만 빠진 노선은 역 이름으로.
 * 예: ["임진강·운천(경의중앙선)", "인천자기부상"].
 */
function computeExcluded(): string[] {
  const supported = new Set(SUPPORTED_LINES);
  const partial = new Map<string, string[]>();
  const whole = new Set<string>();
  for (const [, name, lineIdx, , ok] of rawStations) {
    if (ok === 1) continue;
    for (const i of lineIdx) {
      const line = raw.lines[i] ?? "";
      if (!line) continue;
      if (supported.has(line)) partial.set(line, [...(partial.get(line) ?? []), name]);
      else whole.add(line);
    }
  }
  return [
    ...[...partial]
      .sort(([a], [b]) => byLineOrder(a, b))
      .map(([line, names]) => `${names.sort((a, b) => b.localeCompare(a, "ko")).join("·")}(${line})`),
    ...[...whole].sort(byLineOrder),
  ];
}
export const EXCLUDED_PLACES: readonly string[] = computeExcluded();

const FEW_TRAINS = "열차가 하루 몇 번뿐인 구간이라 계산하지 않아요";

/** 계산하지 않는 이유. `station`(역 코드) 또는 `line`(표시 노선명)으로 맞춘다. `tago`는 tago-scope.json의 원본 항목. */
export const UNSUPPORTED_REASONS: readonly { tago: string; station?: string; line?: string; text: string }[] = [
  // 문산~임진강 셔틀: 평일 평시 배차 약 7.8시간(하루 몇 회).
  { tago: "MTRKRK4K336", station: "7sf", text: FEW_TRAINS }, // 운천
  { tago: "MTRKRK4K337", station: "73b", text: FEW_TRAINS }, // 임진강
  // 2025-10부터 관광·체험열차로 화~일 10~17시 약 35분 간격 운행.
  { tago: "MTRIAM1", line: "인천자기부상", text: "관광용 열차가 띄엄띄엄 다녀서 계산하지 않아요" },
];
const OUTSIDE_CAPITAL_AREA = "아직 수도권 전철만 계산해요";
const UNKNOWN_REASON = "아직 계산하지 못하는 역이에요";

/** 계산하지 않는 역 옆에 붙는 한 줄. 계산할 수 있는 역이면 null. */
export function unsupportedReason(station: Pick<Station, "code" | "lines" | "supported">): string | null {
  if (station.supported) return null;
  const hit =
    UNSUPPORTED_REASONS.find((r) => r.station === station.code) ??
    UNSUPPORTED_REASONS.find((r) => r.line !== undefined && station.lines.includes(r.line));
  if (hit) return hit.text;
  return station.lines.some(isCapitalAreaLine) ? UNKNOWN_REASON : OUTSIDE_CAPITAL_AREA;
}
