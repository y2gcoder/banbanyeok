/**
 * 웹 역 검색용 가벼운 인덱스를 만든다(원본 stations.json 374KB를 그대로 번들하지 않는다).
 *
 * 입력: data/artifacts/dev/{stations.json, od.bin, manifest.json} (형식: contracts/data-format.md §3~5)
 * 출력: src/lib/stations/index.gen.json — 활성 역의 [코드, 이름, 노선 번호들, 별칭들, 출발 가능 여부, 위도, 경도]
 *
 * "출발 가능"은 od.bin 출발역 축에 있는 역이다. 서버가 계산할 수 있는 출발역만 고르게 하고,
 * 나머지는 검색에 보이되 "아직 수도권 지하철역만 계산할 수 있어요"로 안내한다.
 * 좌표는 지도 앱 길찾기 링크(카카오맵 웹)에만 쓰며 출발 가능 역·후보역만 담는다(소수 5자리 ≈ 1m).
 *
 * 사용: pnpm gen:stations  (CI는 재생성 후 git diff로 커밋본과 비교한다)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const artifacts = resolve(root, "data/artifacts/dev");
const out = resolve(root, "web/src/lib/stations/index.gen.json");

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/** 기관 노선명 → 화면 표시 노선명. 모르는 노선은 원래 이름을 쓰고 경고한다. */
const LINE_LABELS: Record<string, string> = {
  "1호선": "1호선",
  경부선: "1호선",
  경원선: "1호선",
  경인선: "1호선",
  장항선: "1호선",
  "2호선": "2호선",
  "3호선": "3호선",
  일산선: "3호선",
  "4호선": "4호선",
  안산과천선: "4호선",
  진접선: "4호선",
  "5호선": "5호선",
  "6호선": "6호선",
  "7호선": "7호선",
  "도시철도 7호선": "7호선",
  "8호선": "8호선",
  "수도권 광역철도 8호선": "8호선",
  "서울 도시철도 9호선": "9호선",
  "수도권  도시철도 9호선": "9호선",
  경의중앙선: "경의중앙선",
  경춘선: "경춘선",
  분당선: "수인분당선",
  수인선: "수인분당선",
  신분당선: "신분당선",
  경강선: "경강선",
  서해선: "서해선",
  인천국제공항선: "공항철도",
  "인천지하철 1호선": "인천1호선",
  "인천지하철 2호선": "인천2호선",
  에버라인: "에버라인",
  의정부: "의정부경전철",
  우이신설선: "우이신설선",
  "수도권 경량도시철도 신림선": "신림선",
  김포도시철도: "김포골드라인",
  자기부상철도: "인천자기부상",
  "부산 도시철도 1호선": "부산1호선",
  "부산 도시철도 2호선": "부산2호선",
  "부산 도시철도 3호선": "부산3호선",
  "부산 경량도시철도 4호선": "부산4호선",
  부산김해경전철: "부산김해경전철",
  동해선: "동해선",
  "대구 도시철도 1호선": "대구1호선",
  "대구 도시철도 2호선": "대구2호선",
  "대구 도시철도 3호선": "대구3호선",
  대경선: "대경선",
  "대전 도시철도 1호선": "대전1호선",
  "광주도시철도 1호선": "광주1호선",
};

type RegistryStation = {
  code: string;
  name: string;
  status: "active" | "deprecated";
  lat: number;
  lng: number;
  lines: string[];
  aliases: string[];
};

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

const registry = JSON.parse(readFileSync(resolve(artifacts, "stations.json"), "utf8")) as {
  registryVersion: number;
  stations: RegistryStation[];
};
const manifest = JSON.parse(readFileSync(resolve(artifacts, "manifest.json"), "utf8")) as { dataVersion: string };
const { origins, candidates } = readOdAxes(readFileSync(resolve(artifacts, "od.bin")));

const lineTable: string[] = [];
const unknownLines = new Set<string>();
function lineIndex(raw: string): number {
  const label = LINE_LABELS[raw] ?? raw;
  if (!(raw in LINE_LABELS)) unknownLines.add(raw);
  let i = lineTable.indexOf(label);
  if (i < 0) i = lineTable.push(label) - 1;
  return i;
}

const stations = registry.stations
  .filter((s) => s.status === "active")
  .map((s) => {
    const lines = [...new Set(s.lines.map(lineIndex))].sort((a, b) => lineOrder(a) - lineOrder(b) || a - b);
    // "신내역"처럼 이름에 "역"만 붙인 별칭은 검색이 접미사를 직접 처리하므로 뺀다.
    const aliases = s.aliases.filter((a) => a !== `${s.name}역`);
    const supported = origins.has(s.code);
    const geo = supported || candidates.has(s.code) ? [round5(s.lat), round5(s.lng)] : [];
    return [s.code, s.name, lines, aliases, supported ? 1 : 0, ...geo];
  });

for (const raw of unknownLines) console.warn(`알 수 없는 노선명(그대로 씀): ${raw}`);

const body = {
  "//": "pnpm gen:stations가 만든 파일. 직접 고치지 않는다.",
  registryVersion: registry.registryVersion,
  dataVersion: manifest.dataVersion,
  lines: lineTable,
  stations,
};
writeFileSync(out, `${JSON.stringify(body)}\n`);
process.stdout.write(
  `stations: ${stations.length} (출발 가능 ${origins.size}), lines: ${lineTable.length}, bytes: ${JSON.stringify(body).length}\n`,
);
