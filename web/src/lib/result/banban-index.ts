/**
 * 반반지수 시안(#202). 버리는 프로토타입이다: 주소에 `bbi=spread|toptwo|ratio`가 있을 때만 결과 화면 1위 카드, `/s/og`,
 * 방 미리보기 그림에 등급을 그린다. 없으면 지금 화면 그대로다. 분포표는 prototype/banban_index.py가 같은 규칙으로 만든다.
 *
 * 입력은 1위 후보의 사람별 표시 분과 같은 결과의 다른 후보들(그룹 최선 비교용)이다. 공평 순위는 건드리지 않는다.
 */
import type { Mode } from "@/lib/api/types";
import { OG_TEXT } from "@/lib/copy/og-text";
import { formatMinutes } from "@/lib/display/minutes";

export const BANBAN_PARAM = "bbi";

export type BanbanPlan = "spread" | "toptwo" | "ratio";
type BanbanGrade = "even" | "near" | "bestHere" | "tilted";
export type BanbanIndex = { plan: BanbanPlan; grade: BanbanGrade; label: string; detail: string };

type Rule = {
  measure: (minutes: readonly number[]) => number;
  even: number;
  near: number;
  lowerIsBetter: boolean;
  detail: (minutes: readonly number[], value: number) => string;
};

const spreadOf = (m: readonly number[]) => Math.max(...m) - Math.min(...m);
const topTwoGap = (m: readonly number[]) => {
  const [first = 0, second = 0] = [...m].sort((a, b) => b - a);
  return first - second;
};
const ratioOf = (m: readonly number[]) => (Math.max(...m) === 0 ? 1 : Math.min(...m) / Math.max(...m));

const RULES: Record<BanbanPlan, Rule> = {
  spread: {
    measure: spreadOf,
    even: 2,
    near: 6,
    lowerIsBetter: true,
    detail: (_, v) => `${OG_TEXT.spreadPrefix}${formatMinutes(v)}`,
  },
  toptwo: {
    measure: topTwoGap,
    even: 2,
    near: 6,
    lowerIsBetter: true,
    detail: (m, v) =>
      m.length <= 2
        ? `${OG_TEXT.spreadPrefix}${formatMinutes(v)}`
        : `${OG_TEXT.banbanTopTwo}${OG_TEXT.spreadPrefix}${formatMinutes(v)}`,
  },
  ratio: {
    measure: ratioOf,
    even: 0.9,
    near: 0.75,
    lowerIsBetter: false,
    detail: (_, v) => `${OG_TEXT.banbanRatioLead}${String(Math.round(v * 100))}${OG_TEXT.banbanRatioTail}`,
  },
};

const LABEL: Record<BanbanGrade, string> = {
  even: OG_TEXT.banbanEven,
  near: OG_TEXT.banbanNear,
  bestHere: OG_TEXT.banbanBestHere,
  tilted: OG_TEXT.banbanTilted,
};

/** 그룹 최선과 비교할 후보: 1위보다 가장 오래 걸리는 시간이 이만큼(분)까지 긴 곳. */
const FLOOR_WINDOW = 10;
/** 1위 값이 그 후보들의 가장 좋은 값보다 이만큼(분) 이내면 '이 조합에선 가장 반반'. */
const FLOOR_SLACK = 2;

export function banbanPlan(value: string | null | undefined): BanbanPlan | null {
  return value === "spread" || value === "toptwo" || value === "ratio" ? value : null;
}

/** 공평 기준에서만 값이 있다(빨리·누구 쪽으로는 '반반'을 말하지 않는다). 갈 수 없는 사람이 있으면 없다. */
export function banbanIndex(
  plan: BanbanPlan | null,
  mode: Mode,
  top: readonly (number | null)[],
  others: readonly (readonly number[])[],
): BanbanIndex | null {
  if (plan === null || mode !== "fair" || top.length < 2 || top.some((m) => m === null)) return null;
  const minutes = top as readonly number[];
  const rule = RULES[plan];
  const value = rule.measure(minutes);
  const better = (a: number, b: number) => (rule.lowerIsBetter ? a <= b : a >= b);
  const grade = ((): BanbanGrade => {
    if (better(value, rule.even)) return "even";
    if (better(value, rule.near)) return "near";
    const window = others.filter((o) => Math.max(...o) <= Math.max(...minutes) + FLOOR_WINDOW).map(rule.measure);
    const best = rule.lowerIsBetter ? Math.min(value, ...window) : Math.max(value, ...window);
    const slack = rule.lowerIsBetter ? FLOOR_SLACK : FLOOR_SLACK / Math.max(1, ...minutes);
    return better(value, rule.lowerIsBetter ? best + slack : best - slack) ? "bestHere" : "tilted";
  })();
  return { plan, grade, label: LABEL[grade], detail: rule.detail(minutes, value) };
}
