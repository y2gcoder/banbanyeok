/** 입력 순서별 사람 색(globals.css의 --p1~--p4). 막대·점에만 쓴다. */
const PERSON_COLORS = ["var(--p1)", "var(--p2)", "var(--p3)", "var(--p4)"] as const;

export function personColor(index: number): string {
  return PERSON_COLORS[index % PERSON_COLORS.length] ?? "var(--ink)";
}
