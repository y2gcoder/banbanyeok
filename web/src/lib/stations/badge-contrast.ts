/**
 * 화면의 작은 노선 배지(11px) 글자색. 작은 글자 AA(4.5:1)를 맞춘다. lines.ts의 `lineTextColor`는 미리보기 그림(OG)의 큰 배지 글자용이라
 * (큰 글자 기준 3:1은 모든 노선이 넘는다) 그대로 두고, 화면 배지만 여기서 보정한다.
 */
import { lineColor, lineTextColor } from "./lines";

const WHITE = "#ffffff";
const BLACK = "#000000";

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 대비. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * OG와 같은 글자색이 4.5:1에 못 미치는 중간 밝기 노선색(5·7·8호선, 경춘선, 김포골드라인)은 흰색·검정 중 대비가 높은 쪽을 쓴다.
 * 흰색·검정 중 하나는 어떤 배경에서도 4.5:1을 넘는다.
 */
export function smallBadgeTextColor(label: string): string {
  const bg = lineColor(label);
  const same = lineTextColor(label);
  if (contrastRatio(bg, same) >= 4.5) return same;
  return contrastRatio(bg, WHITE) >= contrastRatio(bg, BLACK) ? WHITE : BLACK;
}
