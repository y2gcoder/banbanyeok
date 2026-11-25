/**
 * 부산권 화면 시안(#180 5단계, 개발 전용 /drafts/busan)의 역 픽스처를 만든다. 운영 화면은 이 파일을 읽지 않는다.
 *
 * 입력: data/artifacts/dev/stations.json, data/config/busan-services.json
 * 출력: src/app/drafts/busan/_draft/busan-stations.gen.json — [코드, 이름, 노선들, 위도, 경도, 출발 못 하는 요일들]
 *
 * 권역은 부산 노선(부산1~4호선·부산김해경전철·동해선)이 붙은 역으로 정한다. 발행 데이터의 원본은 M1 '권역'(ADR-0008)이고,
 * 요일별 출발 가능 여부의 원본은 manifest 5세대 `regionCoverage.unsupportedOrigins`다(data-format §12). 이 픽스처는 둘 다 발행
 * 전이라 busan-services.json의 계통별 요일 표에서 근사한다: 역의 어느 계통도 그 요일 표가 없으면 그 요일에 출발할 수 없다.
 * 부전 외부 도보(outdoorLinks)로 이어진 역은 건너편 계통도 탈 수 있다고 본다.
 *
 * 사용: node scripts/build-busan-draft-fixture.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stationLineLabels } from "./station-lines.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = resolve(root, "web/src/app/drafts/busan/_draft/busan-stations.gen.json");

type RegistryStation = {
  code: string;
  name: string;
  status: string;
  lat: number;
  lng: number;
  lines: string[];
  sources: Record<string, string>;
};
type Service = { label: string; numberedDays?: Record<string, string>; numberedComparisonDay?: string };

const registry = JSON.parse(readFileSync(resolve(root, "data/artifacts/dev/stations.json"), "utf8")) as {
  stations: RegistryStation[];
};
const config = JSON.parse(readFileSync(resolve(root, "data/config/busan-services.json"), "utf8")) as {
  services: Record<string, Service>;
  transfers: { outdoorLinks: { stations: string[] }[] };
};

const DAY_TYPES = ["weekday", "saturday", "holiday"] as const;
const services = Object.values(config.services);
const daysOf = (label: string): readonly string[] => {
  const service = services.find((s) => s.label === label);
  if (!service) return [];
  if (service.numberedComparisonDay === "all-days") return DAY_TYPES;
  return Object.keys(service.numberedDays ?? {});
};
const busanLabels = new Set(services.map((s) => s.label));

const stations = registry.stations
  .filter((s) => s.status === "active")
  .map((s) => ({ ...s, labels: stationLineLabels(s) }))
  .filter((s) => s.labels.some((l) => busanLabels.has(l)));
const byCode = new Map(stations.map((s) => [s.code, s]));

const linked = new Map<string, string[]>();
for (const { stations: pair } of config.transfers.outdoorLinks) {
  for (const code of pair)
    linked.set(
      code,
      pair.filter((c) => c !== code),
    );
}

const rows = stations
  .map((s) => {
    const reachable = [s.labels, ...(linked.get(s.code) ?? []).map((c) => byCode.get(c)?.labels ?? [])].flat();
    const unsupported = DAY_TYPES.filter((day) => !reachable.some((l) => daysOf(l).includes(day)));
    return [s.code, s.name, s.labels, Math.round(s.lat * 1e5) / 1e5, Math.round(s.lng * 1e5) / 1e5, unsupported];
  })
  .sort((a, b) => String(a[1]).localeCompare(String(b[1]), "ko") || String(a[0]).localeCompare(String(b[0])));

writeFileSync(out, `${JSON.stringify({ source: "data/artifacts/dev/stations.json", stations: rows })}\n`);
process.stdout.write(`busan draft fixture: ${rows.length} stations → ${out.slice(root.length + 1)}\n`);
