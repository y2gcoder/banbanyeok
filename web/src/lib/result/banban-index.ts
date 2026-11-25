/**
 * 반반지수 시안(#202). 버리는 프로토타입이다: 주소에 `bbi=spread|toptwo|ratio`가 있을 때만 결과 화면 1위 카드, `/s/og`,
 * 방 미리보기 그림에 등급을 그린다. `bbi=fact|factcap`은 등급 대신 화면 숫자로 확인할 수 있는 사실 문장 하나를 그리고, 자랑할 만하지
 * 않으면 아무것도 그리지 않는다. 없으면 지금 화면 그대로다. 분포표는 prototype/banban_index.py가 같은 규칙으로 만든다.
 *
 * 입력은 1위 후보의 사람별 표시 분과 같은 결과의 다른 후보들(그룹 최선 비교용)이다. 공평 순위는 건드리지 않는다.
 */
import type { Mode } from "@/lib/api/types";
import { OG_TEXT } from "@/lib/copy/og-text";
import { formatMinutes } from "@/lib/display/minutes";

export const BANBAN_PARAM = "bbi";

type GradePlan = "spread" | "toptwo" | "ratio";
/** `fact`는 여러 명 문장에 실제 차이를, `factcap`은 문턱 값을 쓴다. 두 사람 문장은 둘 다 실제 차이다. */
type FactPlan = "fact" | "factcap";
export type BanbanPlan = GradePlan | FactPlan;
type BanbanGrade = "even" | "near" | "bestHere" | "tilted";
export type BanbanIndex =
  | { kind: "grade"; plan: GradePlan; grade: BanbanGrade; label: string; detail: string }
  | { kind: "fact"; plan: FactPlan; sentence: string };

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
/** 화면에 쓰는 백분율(반올림)로 등급을 정해 보이는 숫자와 문턱이 어긋나지 않게 한다. */
const ratioOf = (m: readonly number[]) =>
  Math.max(...m) === 0 ? 1 : Math.floor((Math.min(...m) / Math.max(...m)) * 100 + 0.5) / 100;

const RULES: Record<GradePlan, Rule> = {
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

/** 사실 문장을 붙이는 도착 차이(최장 − 최단) 문턱(분): 두 사람, 세 사람 이상. */
const FACT_PAIR = 2;
const FACT_GROUP = 6;

const PLANS: readonly BanbanPlan[] = ["spread", "toptwo", "ratio", "fact", "factcap"];

export function banbanPlan(value: string | null | undefined): BanbanPlan | null {
  return PLANS.find((plan) => plan === value) ?? null;
}

function factSentence(plan: FactPlan, minutes: readonly number[]): string | null {
  const pair = minutes.length === 2;
  const limit = pair ? FACT_PAIR : FACT_GROUP;
  const gap = spreadOf(minutes);
  if (gap > limit) return null;
  const who = pair ? OG_TEXT.factPair : OG_TEXT.factGroup;
  const shown = plan === "factcap" && !pair ? limit : gap;
  if (shown === 0) return `${who}${OG_TEXT.factSame}`;
  return `${who}${formatMinutes(shown)}${pair ? OG_TEXT.factPairTail : OG_TEXT.factGroupTail}`;
}

/**
 * 방 미리보기에는 믿을 숨김 표시가 없다. 숨긴 사람의 시간은 남에게 5분 단위로 올려 보이므로(ADR-0004), 5분 배수인 시간이 하나라도
 * 있으면 숨긴 사람이 있을 수 있다고 본다. 숨기지 않은 사람도 걸리지만 등급을 빼는 쪽으로만 틀린다.
 */
export function mayIncludeHidden(minutes: readonly (number | null)[]): boolean {
  return minutes.some((m) => m !== null && m % 5 === 0);
}

/**
 * 공평 기준에서만 값이 있다(빨리·누구 쪽으로는 '반반'을 말하지 않는다). 갈 수 없는 사람이 있으면 없다.
 * 숨긴 사람이 있으면 없다: 본인은 정확한 시간, 남은 5분 단위 시간을 보므로 같은 방에서 등급이 갈린다.
 * `others`가 null이면(방 미리보기: 1위만 온다) 그룹 최선과 비교할 수 없으므로 낮은 등급은 그리지 않는다.
 */
export function banbanIndex(
  plan: BanbanPlan | null,
  input: {
    mode: Mode;
    top: readonly (number | null)[];
    others: readonly (readonly number[])[] | null;
    hidden: boolean;
  },
): BanbanIndex | null {
  const { mode, top, others, hidden } = input;
  if (plan === null || hidden || mode !== "fair" || top.length < 2 || top.some((m) => m === null)) return null;
  const minutes = top as readonly number[];
  if (plan === "fact" || plan === "factcap") {
    const sentence = factSentence(plan, minutes);
    return sentence === null ? null : { kind: "fact", plan, sentence };
  }
  const rule = RULES[plan];
  const value = rule.measure(minutes);
  const better = (a: number, b: number) => (rule.lowerIsBetter ? a <= b : a >= b);
  const grade = ((): BanbanGrade | null => {
    if (better(value, rule.even)) return "even";
    if (better(value, rule.near)) return "near";
    if (others === null) return null;
    const window = others.filter((o) => Math.max(...o) <= Math.max(...minutes) + FLOOR_WINDOW).map(rule.measure);
    const best = rule.lowerIsBetter ? Math.min(value, ...window) : Math.max(value, ...window);
    const slack = rule.lowerIsBetter ? FLOOR_SLACK : FLOOR_SLACK / Math.max(1, ...minutes);
    return better(value, rule.lowerIsBetter ? best + slack : best - slack) ? "bestHere" : "tilted";
  })();
  if (grade === null) return null;
  return { kind: "grade", plan, grade, label: LABEL[grade], detail: rule.detail(minutes, value) };
}
