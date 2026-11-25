/**
 * 역 인덱스(빌드 스크립트가 만든 index.gen.json)와 검색.
 * 자동완성은 이름 생략형("홍대"), "역" 접미사, 초성("ㅎㄷ"), 조합 중 글자("홍ㄷ"), 영문 자판으로 친 한글("ghdeo")을 받는다.
 */
import { convertQwertyToHangul, disassemble, getChoseong } from "es-hangul";
import raw from "./index.gen.json";

/** 교통 권역(ADR-0008). 한 방·한 추천은 한 권역 안에서만 계산한다. */
export type RegionId = "capital" | "busan";

const REGION_NAMES: Readonly<Record<RegionId, string>> = { capital: "수도권", busan: "부산권" };

export function regionName(region: RegionId): string {
  return REGION_NAMES[region];
}

export type Station = {
  code: string;
  name: string;
  lines: string[];
  aliases: string[];
  /** 서버가 출발역으로 계산할 수 있는 역(od.bin의 출발역 축). */
  supported: boolean;
  geo: { lat: number; lng: number } | null;
  region: RegionId;
};

type RawStation = [string, string, number[], string[], number, ...number[]];
type RawSlotCoverage = { available: boolean; missingServices: string[]; unsupportedOrigins: string[] };
type RawRegion = { id: string; stations?: string[]; coverage: Record<string, RawSlotCoverage> };

type Searchable = Station & { jamo: string; choseong: string; aliasJamo: string[] };

const lineTable: readonly string[] = raw.lines;

function parseRegion(id: string): RegionId {
  if (id in REGION_NAMES) return id as RegionId;
  throw new Error(`역 인덱스의 모르는 권역: ${id}`);
}

/** 권역 데이터가 없는 인덱스(manifest 1~4세대)는 수도권 하나다. */
const rawRegions: readonly RawRegion[] = (raw as { regions?: RawRegion[] }).regions ?? [
  { id: "capital", coverage: {} },
];

/** 인덱스의 권역(수도권이 먼저). */
export const REGIONS: readonly RegionId[] = rawRegions.map((r) => parseRegion(r.id));
export const DEFAULT_REGION: RegionId = REGIONS[0] ?? "capital";

/**
 * 권역 화면(권역 고르기·권역 문구·구분별 출발 가능 여부)을 켜는 조건: 발행된 인덱스에 권역이 둘 이상 있다. 별도 플래그를 두지 않아
 * 부산권 데이터가 인덱스에 실린 배포부터 켜지고, 그 전에는 화면이 권역을 모르던 때와 같다.
 */
export const REGIONS_ENABLED: boolean = REGIONS.length > 1;

/** 이 웹 빌드의 역 인덱스를 만든 manifest dataVersion. */
export const INDEX_DATA_VERSION: string = raw.dataVersion;

const regionByCode = new Map<string, RegionId>(
  rawRegions.flatMap((r) => (r.stations ?? []).map((code) => [code, parseRegion(r.id)] as const)),
);

function toStation([code, name, lineIdx, aliases, supported, lat, lng]: RawStation): Station {
  return {
    code,
    name,
    lines: lineIdx.map((i) => lineTable[i] ?? ""),
    aliases,
    supported: supported === 1,
    geo: lat !== undefined && lng !== undefined ? { lat, lng } : null,
    region: regionByCode.get(code) ?? DEFAULT_REGION,
  };
}

const stations: readonly Station[] = (raw.stations as RawStation[]).map(toStation);

/** 권역·구분별로 출발할 수 없는 사정. 인덱스에 없는 구분은 완전하다(빌드가 완전한 구분을 싣지 않는다). */
export type SlotGap = {
  /** 구분 전체를 계산하지 못한다(regionCoverage `available=false`). */
  wholeSlot: boolean;
  /** 배차를 확인하지 못한 계통의 표시 이름. */
  missingServices: readonly string[];
};

const coverage = new Map<RegionId, ReadonlyMap<string, RawSlotCoverage>>(
  rawRegions.map((r) => [parseRegion(r.id), new Map(Object.entries(r.coverage))]),
);

/** 그 구분에 이 역에서 출발할 수 없으면 그 사정, 출발할 수 있으면 null. `slot`은 구분 id(`saturday-day`). */
export function slotGap(station: Pick<Station, "code" | "region">, slot: string): SlotGap | null {
  const c = coverage.get(station.region)?.get(slot);
  if (!c) return null;
  if (!c.available) return { wholeSlot: true, missingServices: c.missingServices };
  return c.unsupportedOrigins.includes(station.code) ? { wholeSlot: false, missingServices: c.missingServices } : null;
}

/** dataVersion(`YYYYMMDD.N`) 비교. 날짜와 N을 숫자로 견준다(문자열로 견주면 .10 < .9가 된다). */
export function compareDataVersions(a: string, b: string): number {
  const [aDay = 0, aRev = 0] = a.split(".").map(Number);
  const [bDay = 0, bRev = 0] = b.split(".").map(Number);
  return aDay - bDay || aRev - bRev;
}
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

function searchOnce(query: string, limit: number, region: RegionId | null): Station[] {
  const jamo = disassemble(query);
  const hits: { station: Searchable; score: number }[] = [];
  for (const station of searchIndex()) {
    if (region !== null && station.region !== region) continue;
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

/** 한/영 전환을 잊고 친 경우("ghdeo" → "홍대")의 한글 질의. 영문 자판 글자만 쳤을 때만 있다. */
function hangulTypo(query: string): string | null {
  return LATIN_ONLY.test(query) ? normalize(convertQwertyToHangul(query)) : null;
}

/** 역 이름 검색. `region`을 주면 그 권역의 역만 찾고 나서 자른다. */
export function searchStations(input: string, limit = 8, region: RegionId | null = null): Station[] {
  const query = normalize(input);
  if (!query) return [];
  const results = searchOnce(query, limit, region);
  const typo = hangulTypo(query);
  if (results.length === 0 && typo !== null) return searchOnce(typo, limit, region);
  return results;
}

/** 친 글자가 그 역의 이름과 같은가(검색과 같은 정규화: 공백, 끝의 "역", 한/영 자판 변환). */
export function isExactName(station: Station, input: string): boolean {
  const query = normalize(input);
  return station.name === query || station.name === hangulTypo(query);
}

/** 역 코드들의 권역(중복 없이 인덱스 순서). 인덱스에 없는 코드는 건너뛴다. */
export function regionsOf(codes: readonly (string | null | undefined)[]): RegionId[] {
  const found = new Set(codes.flatMap((code) => (code ? [stationByCode(code)?.region] : [])));
  return REGIONS.filter((r) => found.has(r));
}
