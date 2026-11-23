/**
 * 레지스트리 역의 노선 목록(KRIC 법정 노선명) → 화면 표시 노선명. build-station-index.ts가 쓰고 테스트가 직접 부른다.
 */

/** 기관 노선명 → 화면 표시 노선명. 모르는 노선은 원래 이름을 쓰고 경고한다. 경원선은 여기 없다(아래 GYEONGWON_SERVICES). */
export const LINE_LABELS: Record<string, string> = {
  "1호선": "1호선",
  경부선: "1호선",
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
  "GTX-A": "GTX-A",
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

/**
 * 법정 노선 경원선(KRIC 노선번호 I4102)은 용산~연천을 한 코드로 덮지만 운행은 구간마다 다르다(#130).
 * 회기 이북은 1호선, 용산~왕십리는 경의중앙선, 왕십리·청량리는 수인분당선도 선다.
 * 그래서 경원선 행은 그 역에 붙은 TAGO 운행 노선(레지스트리 sources의 `tago:<계통>`)으로 푼다.
 */
const GYEONGWON_SERVICES: Record<string, string> = {
  "tago:1호선": "1호선",
  "tago:경의중앙": "경의중앙선",
  "tago:수인분당": "수인분당선",
};

export type LineSourceStation = { code: string; name: string; lines: string[]; sources: Record<string, string> };

/** KRIC/TAGO 모델과 실제 정기 운행이 다른 역의 표시 보정. 그래프 범위와 배지 범위는 다르다(#132). */
const STATION_LINE_ADJUSTMENTS: Record<string, { remove?: string[]; add?: string[] }> = {
  // 광운대: 경의중앙선 정차 없음, 평일 경춘선 2왕복은 유지. 코레일 시각표 확인 2026-11-23.
  // https://www.korail.com/file/cubedata/COMMON/jfile/202608/28/202608281a045c7905b490.xlsx
  "1y8": { remove: ["경의중앙선"] },
  // 청량리: 경춘선 정기 운행(경춘선 상·하행 시트). 코레일 시각표 확인 2026-11-23.
  // https://www.korail.com/file/cubedata/COMMON/jfile/202608/28/202608281a045c7905b490.xlsx
  mj0: { add: ["경춘선"] },
  // 회기: 경춘선 정기 정차(경춘선 상·하행 시트). 코레일 시각표 확인 2026-11-23.
  // https://www.korail.com/file/cubedata/COMMON/jfile/202608/28/202608281a045c7905b490.xlsx
  dyp: { add: ["경춘선"] },
};

/** 역의 표시 노선명(원천 순서, 중복 가능). 모르는 노선명은 그대로 쓰고 `unknown`에 모은다. */
export function stationLineLabels(station: LineSourceStation, unknown: Set<string> = new Set()): string[] {
  const labels = station.lines.flatMap((raw) => {
    if (raw === "경원선") return gyeongwonLabels(station);
    const label = LINE_LABELS[raw];
    if (label === undefined) unknown.add(raw);
    return [label ?? raw];
  });
  const adjustment = STATION_LINE_ADJUSTMENTS[station.code];
  return labels.filter((label) => !adjustment?.remove?.includes(label)).concat(adjustment?.add ?? []);
}

/** 경원선 역의 운행 노선. 아는 TAGO 운행 노선이 하나도 없으면 1호선으로 짐작하지 않고 생성을 멈춘다. */
function gyeongwonLabels(station: LineSourceStation): string[] {
  const labels = Object.entries(GYEONGWON_SERVICES)
    .filter(([source]) => source in station.sources)
    .map(([, label]) => label);
  if (labels.length === 0)
    throw new Error(
      `경원선 역 ${station.name}(${station.code})에 TAGO 운행 노선(${Object.keys(GYEONGWON_SERVICES).join(", ")})이 없음`,
    );
  return labels;
}
