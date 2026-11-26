/**
 * 노선 배지 색. 표시 노선명(scripts/station-lines.ts의 stationLineLabels 결과)별 공식 노선색에 가깝게 맞췄다.
 * 계산하지 않는 노선(대구·대전·광주 등)은 중립색을 쓴다.
 */
const LINE_COLORS: Record<string, string> = {
  "1호선": "#0052a4",
  "2호선": "#00a84d",
  "3호선": "#ef7c1c",
  "4호선": "#00a5de",
  "5호선": "#996cac",
  "6호선": "#cd7c2f",
  "7호선": "#747f00",
  "8호선": "#e6186c",
  "9호선": "#bdb092",
  경의중앙선: "#77c4a3",
  경춘선: "#0c8e72",
  수인분당선: "#f5a200",
  신분당선: "#d4003b",
  경강선: "#003da5",
  서해선: "#8fc31f",
  공항철도: "#0090d2",
  인천1호선: "#7ca8d5",
  인천2호선: "#ed8b00",
  에버라인: "#509f22",
  의정부경전철: "#fda600",
  우이신설선: "#b0ce18",
  신림선: "#6789ca",
  김포골드라인: "#a17800",
  "GTX-A": "#9a6292",
  // 부산권(#180). 운영사 공식 CI 문서의 hex 값은 찾지 못했다. 1~4호선은 부산시가 밝힌 색 이름(오렌지·그린·브라운·블루 라인)과
  // 위키백과 '틀:한국 철도 노선색'(2026-11-26 확인)의 값이 맞고, 부산김해경전철은 그 틀이 운영사 노선도에서 뽑은 값이다.
  // https://ko.wikipedia.org/wiki/틀:한국_철도_노선색 · https://www.busan.go.kr/news/snsbusan01/view?dataNo=29115&gugun=Prev
  부산1호선: "#f06a00",
  부산2호선: "#81bf48",
  부산3호선: "#bb8c00",
  부산4호선: "#217dcb",
  부산김해경전철: "#8652a1",
  // 동해선: 위키 문서의 '동해선 광역전철' 상징색(구 코레일 블루)뿐이고 코레일 공식 값은 확인하지 못했다.
  동해선: "#0054a6",
};

/** 배지 안 짧은 글자가 이름에서 나오지 않는 노선(부산권 알약 "부산1"·"김해"·"동해"). */
const SHORT_LABELS: Record<string, string> = {
  부산1호선: "부산1",
  부산2호선: "부산2",
  부산3호선: "부산3",
  부산4호선: "부산4",
  부산김해경전철: "김해",
  동해선: "동해",
};

const NEUTRAL_LINE_COLOR = "#8a9099";

/** 계산하는 권역의 노선인지(색표에 있는지). 계산 불가 역의 안내 문구를 고를 때 쓴다. */
export function isServiceLine(label: string): boolean {
  return label in LINE_COLORS;
}

export function lineColor(label: string): string {
  return LINE_COLORS[label] ?? NEUTRAL_LINE_COLOR;
}

/** 배지 안 짧은 글자: "2호선" → "2", "수인분당선" → "수인분당", "부산1호선" → "부산1". */
export function lineShortLabel(label: string): string {
  const fixed = SHORT_LABELS[label];
  if (fixed) return fixed;
  const numbered = /^(\d)호선$/.exec(label);
  if (numbered?.[1]) return numbered[1];
  return label.replace(/선$/, "");
}

/** 배지 글자색: 밝은 노선색(우이신설·의정부 등)은 진한 글자, 나머지는 흰 글자(대비 확보). */
export function lineTextColor(label: string): string {
  const hex = lineColor(label).slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // 흰 글자와 진한 글자의 대비가 같아지는 휘도(약 0.21)를 기준으로 더 높은 쪽을 고른다.
  return luminance > 0.21 ? "#16201b" : "#ffffff";
}
