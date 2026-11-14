/**
 * 노선 배지 색. 표시 노선명(scripts/build-station-index.ts의 LINE_LABELS 결과)별 공식 노선색에 가깝게 맞췄다.
 * 수도권 밖 노선은 계산 대상이 아니라 중립색을 쓴다.
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
};

const NEUTRAL_LINE_COLOR = "#8a9099";

/** 수도권 노선인지(색표에 있는지). 계산 불가 역의 안내 문구를 고를 때 쓴다. */
export function isCapitalAreaLine(label: string): boolean {
  return label in LINE_COLORS;
}

export function lineColor(label: string): string {
  return LINE_COLORS[label] ?? NEUTRAL_LINE_COLOR;
}

/** 배지 안 짧은 글자: "2호선" → "2", "수인분당선" → "수인분당". */
export function lineShortLabel(label: string): string {
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
