/**
 * 웹 역 검색용 가벼운 인덱스를 만든다(원본 stations.json 374KB를 그대로 번들하지 않는다).
 *
 * 입력: data/artifacts/dev/{stations.json, od.bin, manifest.json} (형식: contracts/data-format.md §3~5),
 *       data/config/network-rules.json(수도권 좌표 창)
 *       권역 포인터 data/artifacts/dev/regional/manifest.v5.json이 있으면 그 세대의 레지스트리·od.bin·regionCoverage를 대신 쓴다(§12).
 *       다른 산출물 폴더로 만들려면 STATION_INDEX_ARTIFACTS=<저장소 기준 경로>, 다른 곳에 쓰려면 STATION_INDEX_OUT=<저장소 기준 경로>.
 *       pnpm gen:stations는 계약 픽스처(contracts/fixtures, 두 권역)로 regional.fixture.gen.json도 만든다. 권역 화면 테스트가 그것을 읽는다.
 * 출력: src/lib/stations/index.gen.json — 활성 역의 [코드, 이름, 노선 번호들, 별칭들, 출발 가능 여부, 위도, 경도]
 *       권역 데이터면 `regions`도 쓴다: 권역 순서, 첫 권역이 아닌 역의 코드, 완전하지 않은 구분의 regionCoverage 값.
 *       권역 데이터가 없으면 `regions`를 쓰지 않아 지금 인덱스와 같다(웹은 권역이 둘 이상일 때만 권역 화면을 켠다).
 *
 * "출발 가능"은 od.bin 출발역 축에 있는 역이다. 서버가 계산할 수 있는 출발역만 고르게 하고,
 * 나머지는 검색에 보이되 고를 수 없고, 이유 문구는 src/lib/stations/coverage.ts가 붙인다.
 * 좌표는 지도 앱 길찾기 링크(카카오맵 웹)에만 쓰며 출발 가능 역·후보역만 담는다(소수 5자리 ≈ 1m).
 * `replaced`는 폐기된 코드 → 정식(active) 코드다. replacedBy 사슬을 끝까지 따라간 값이라 옛 링크·기억한 역이 계속 열린다
 * (contracts/data-format.md §3).
 *
 * 사용: pnpm gen:stations  (CI는 재생성 후 git diff로 커밋본과 비교한다)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stationLineLabels } from "./station-lines.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const artifacts = resolve(root, process.env.STATION_INDEX_ARTIFACTS ?? "data/artifacts/dev");
const out = resolve(root, process.env.STATION_INDEX_OUT ?? "web/src/lib/stations/index.gen.json");

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

type RegistryStation = {
  code: string;
  name: string;
  status: "active" | "deprecated";
  lat: number;
  lng: number;
  lines: string[];
  aliases: string[];
  sources: Record<string, string>;
  replacedBy?: string;
  region?: string;
};

type SlotCoverage = { available: boolean; missingServices: string[]; unsupportedOrigins: string[] };

function decodeCode(value: number): string {
  return `${ALPHABET[value >> 10]}${ALPHABET[(value >> 5) & 31]}${ALPHABET[value & 31]}`;
}

/** od.bin 헤더(§4.1)와 코드 축(§4.2)만 읽는다. */
function readOdAxes(bytes: Buffer): { origins: Set<string>; candidates: Set<string> } {
  if (bytes.toString("ascii", 0, 4) !== "BBOD") throw new Error("od.bin magic");
  const headerSize = bytes.readUInt16LE(6);
  const n = bytes.readUInt32LE(16);
  const m = bytes.readUInt32LE(20);
  const axis = (offset: number, count: number) =>
    new Set(Array.from({ length: count }, (_, i) => decodeCode(bytes.readUInt16LE(offset + 2 * i))));
  return { origins: axis(headerSize, n), candidates: axis(headerSize + 2 * n, m) };
}

/** 배지 순서: 숫자 노선(1~9호선)을 번호순으로 먼저, 나머지는 처음 나온 순서. */
function lineOrder(index: number): number {
  const numbered = /^(\d)호선$/.exec(lineTable[index] ?? "");
  return numbered ? Number(numbered[1]) : 100;
}

function round5(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}

type Source = { registry: string; od: string; manifest: { dataVersion: string } };
/** 권역 세대(§12)가 있으면 그 파일들, 없으면 세대 1의 고정 이름 파일. */
function source(): Source & { coverage: Record<string, Record<string, SlotCoverage>> | null } {
  const pointer = resolve(artifacts, "regional/manifest.v5.json");
  if (!existsSync(pointer)) {
    return { registry: "stations.json", od: "od.bin", manifest: readJson("manifest.json"), coverage: null };
  }
  const manifest = readJson(pointer) as {
    dataVersion: string;
    files: { registry: { path: string }; od: { path: string } };
    regionCoverage: Record<string, Record<string, SlotCoverage>>;
  };
  return {
    registry: manifest.files.registry.path,
    od: manifest.files.od.path,
    manifest,
    coverage: manifest.regionCoverage,
  };
}
function readJson(path: string): { dataVersion: string } {
  return JSON.parse(readFileSync(resolve(artifacts, path), "utf8")) as { dataVersion: string };
}

const input = source();
const registry = JSON.parse(readFileSync(resolve(artifacts, input.registry), "utf8")) as {
  registryVersion: number;
  stations: RegistryStation[];
};
const manifest = input.manifest;
const { origins, candidates } = readOdAxes(readFileSync(resolve(artifacts, input.od)));

const lineTable: string[] = [];
const unknownLines = new Set<string>();
function lineIndex(label: string): number {
  let i = lineTable.indexOf(label);
  if (i < 0) i = lineTable.push(label) - 1;
  return i;
}

/**
 * 수도권 좌표 창(파이프라인 network-rules.json의 physicalStations.scope) 밖에 있고 출발역도 후보도 아닌 역은 색인에서 뺀다.
 * 출발역이 될 수 없는 비수도권 역(부산·대구 등, 원본이 경의중앙선으로 잘못 적은 영동선 양원)이 검색에 섞이지 않게 한다.
 */
const scope = (
  JSON.parse(readFileSync(resolve(root, "data/config/network-rules.json"), "utf8")) as {
    physicalStations: { scope: { minLat: number; maxLat: number; minLng: number; maxLng: number } };
  }
).physicalStations.scope;
function searchable(s: RegistryStation): boolean {
  const inScope = s.lat >= scope.minLat && s.lat <= scope.maxLat && s.lng >= scope.minLng && s.lng <= scope.maxLng;
  return inScope || origins.has(s.code) || candidates.has(s.code);
}

const stations = registry.stations
  .filter((s) => s.status === "active" && searchable(s))
  .map((s) => {
    const lines = [...new Set(stationLineLabels(s, unknownLines).map(lineIndex))].sort(
      (a, b) => lineOrder(a) - lineOrder(b) || a - b,
    );
    // "신내역"처럼 이름에 "역"만 붙인 별칭은 검색이 접미사를 직접 처리하므로 뺀다.
    const aliases = s.aliases.filter((a) => a !== `${s.name}역`);
    const supported = origins.has(s.code);
    const geo = supported || candidates.has(s.code) ? [round5(s.lat), round5(s.lng)] : [];
    return [s.code, s.name, lines, aliases, supported ? 1 : 0, ...geo];
  });

for (const raw of unknownLines) console.warn(`알 수 없는 노선명(그대로 씀): ${raw}`);

/** 폐기된 코드를 사슬 끝의 active 코드로. 순환·끊김은 파이프라인 게이트가 막지만 여기서도 실패로 멈춘다. */
const byCode = new Map(registry.stations.map((s) => [s.code, s]));
function activeCode(start: RegistryStation): string {
  let station = start;
  for (let step = 0; station.status !== "active"; step++) {
    const next = station.replacedBy === undefined ? undefined : byCode.get(station.replacedBy);
    if (!next || step > registry.stations.length)
      throw new Error(`replacedBy 사슬이 active 역에 닿지 않음: ${start.code}`);
    station = next;
  }
  return station.code;
}
const indexed = new Set(stations.map((s) => s[0]));
const replaced = Object.fromEntries(
  registry.stations
    .filter((s) => s.status === "deprecated" && s.replacedBy)
    .map((s) => [s.code, activeCode(s)])
    .filter(([, target]) => indexed.has(target as string)),
);

/**
 * 권역(§12 regionCoverage의 키 순서, 수도권이 먼저). 첫 권역은 기본이라 역 목록을 싣지 않는다. 구분 값은 완전하지 않은
 * 것(출발 못 하는 역·빠진 계통이 있거나 available=false)만 싣고, 빠진 구분은 웹이 완전한 것으로 읽는다.
 */
function regions(coverage: Record<string, Record<string, SlotCoverage>>) {
  const ids = Object.keys(coverage).sort((a, b) => Number(b === "capital") - Number(a === "capital"));
  for (const s of registry.stations)
    if (indexed.has(s.code) && !ids.includes(s.region ?? "capital"))
      throw new Error(`regionCoverage에 없는 권역의 역: ${s.code} ${s.region}`);
  return ids.map((id, i) => {
    const limits = Object.fromEntries(
      Object.entries(coverage[id] ?? {}).filter(
        ([, c]) => !c.available || c.missingServices.length > 0 || c.unsupportedOrigins.length > 0,
      ),
    );
    const codes = registry.stations.filter((s) => indexed.has(s.code) && s.region === id).map((s) => s.code);
    return { id, ...(i === 0 ? {} : { stations: codes }), coverage: limits };
  });
}

const body = {
  "//": "pnpm gen:stations가 만든 파일. 직접 고치지 않는다.",
  registryVersion: registry.registryVersion,
  dataVersion: manifest.dataVersion,
  lines: lineTable,
  stations,
  replaced,
  ...(input.coverage ? { regions: regions(input.coverage) } : {}),
};
writeFileSync(out, `${JSON.stringify(body)}\n`);
process.stdout.write(
  `stations: ${stations.length} (출발 가능 ${origins.size}), replaced: ${Object.keys(replaced).length}, lines: ${lineTable.length}, bytes: ${JSON.stringify(body).length}\n`,
);
