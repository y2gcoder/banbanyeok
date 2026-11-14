/**
 * 역 인덱스(빌드 스크립트가 만든 index.gen.json)와 검색.
 * 자동완성은 이름 생략형("홍대"), "역" 접미사, 초성("ㅎㄷ"), 조합 중 글자("홍ㄷ"), 영문 자판으로 친 한글("ghdeo")을 받는다.
 */
import { convertQwertyToHangul, disassemble, getChoseong } from "es-hangul";
import raw from "./index.gen.json";

export type Station = {
  code: string;
  name: string;
  lines: string[];
  aliases: string[];
  /** 서버가 출발역으로 계산할 수 있는 역(지금은 수도권). */
  supported: boolean;
  geo: { lat: number; lng: number } | null;
};

type RawStation = [string, string, number[], string[], number, ...number[]];

type Searchable = Station & { jamo: string; choseong: string; aliasJamo: string[] };

const lineTable: readonly string[] = raw.lines;

function toStation([code, name, lineIdx, aliases, supported, lat, lng]: RawStation): Station {
  return {
    code,
    name,
    lines: lineIdx.map((i) => lineTable[i] ?? ""),
    aliases,
    supported: supported === 1,
    geo: lat !== undefined && lng !== undefined ? { lat, lng } : null,
  };
}

const stations: readonly Station[] = (raw.stations as RawStation[]).map(toStation);
const byCode = new Map(stations.map((s) => [s.code, s]));
/** 폐기된 코드 → 정식 코드(빌드 때 replacedBy 사슬을 끝까지 따라간 값). */
const replaced: Readonly<Record<string, string>> = raw.replaced;

let searchable: Searchable[] | null = null;
function searchIndex(): Searchable[] {
  searchable ??= stations.map((s) => ({
    ...s,
    jamo: disassemble(s.name),
    choseong: getChoseong(s.name),
    aliasJamo: s.aliases.map((a) => disassemble(a)),
  }));
  return searchable;
}

/** 코드로 역을 찾는다. 폐기된 코드(옛 링크·기억한 역)는 정식 역을 돌려준다. */
export function stationByCode(code: string): Station | undefined {
  return byCode.get(code) ?? byCode.get(replaced[code] ?? "");
}

const CHOSEONG_ONLY = /^[ㄱ-ㅎ]+$/;
const LATIN_ONLY = /^[a-zA-Z]+$/;

function normalize(query: string): string {
  return query.replace(/\s+/g, "").replace(/역$/, "");
}

function rank(station: Searchable, query: string, jamo: string): number | null {
  if (station.name === query) return 0;
  if (station.jamo.startsWith(jamo)) return 1;
  if (CHOSEONG_ONLY.test(query) && station.choseong.startsWith(query)) return 2;
  if (station.aliasJamo.some((a) => a.startsWith(jamo))) return 3;
  if (station.name.includes(query)) return 4;
  if (CHOSEONG_ONLY.test(query) && station.choseong.includes(query)) return 5;
  return null;
}

function searchOnce(query: string, limit: number): Station[] {
  const jamo = disassemble(query);
  const hits: { station: Searchable; score: number }[] = [];
  for (const station of searchIndex()) {
    const score = rank(station, query, jamo);
    if (score !== null) hits.push({ station, score });
  }
  hits.sort(
    (a, b) =>
      a.score - b.score ||
      Number(b.station.supported) - Number(a.station.supported) ||
      a.station.name.length - b.station.name.length ||
      a.station.name.localeCompare(b.station.name, "ko"),
  );
  return hits.slice(0, limit).map(({ station: { jamo: _j, choseong: _c, aliasJamo: _a, ...station } }) => station);
}

export function searchStations(input: string, limit = 8): Station[] {
  const query = normalize(input);
  if (!query) return [];
  const results = searchOnce(query, limit);
  if (results.length === 0 && LATIN_ONLY.test(query)) {
    // 한/영 전환을 잊고 친 경우("ghdeo" → "홍대").
    return searchOnce(normalize(convertQwertyToHangul(query)), limit);
  }
  return results;
}
