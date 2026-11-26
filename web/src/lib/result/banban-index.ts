/**
 * 반반지수(#202): 공평 1위가 왜 공평한지 말하는 한 줄. 공평 순위는 가장 오래 걸리는 사람의 시간이 가장 짧은 역을 고르므로(minimax),
 * 기본 층은 늘 그 시간을 말한다("가장 오래 걸리는 사람도 38분이에요"). 걸리는 시간이 고를 때만 그 줄을 강조 층으로 바꾼다
 * ("걸리는 시간이 모두 4분 차이 안이에요"). 점수·비율은 인원에 따라 틀린 인상을 줘서 쓰지 않는다.
 *
 * 값은 화면에 보이는 사람별 분(반올림)에서만 만든다. 결과 1위 카드, 공유 그림(`/s/og`), 방 미리보기(`/r/<id>/og`)가 이 줄과 함께
 * 사람별 막대를 그리고, null이면 셋 다 지금 그림(최장·차이)이다. 규칙의 기준 구현은 `prototype/banban_index.py`이고 벡터
 * `contracts/golden/banban-lines.json`으로 대조한다.
 */
import type { Mode } from "@/lib/api/types";
import { OG_TEXT } from "@/lib/copy/og-text";
import { formatMinutes } from "@/lib/display/minutes";

export type BanbanLine = { kind: "longest" | "close"; text: string };

/** 강조 층을 붙이는 걸리는 시간 차이(최장 − 최단, 분) 문턱: 두 사람, 세 사람 이상. */
const CLOSE_PAIR = 2;
const CLOSE_GROUP = 6;

/** 숨긴 사람의 시간은 남에게 300초의 배수로 간다(ADR-0004, 서버 `HiddenTimes.coarse`). */
const HIDDEN_STEP_SECONDS = 300;

function closeText(minutes: readonly number[]): string | null {
  const pair = minutes.length === 2;
  const gap = Math.max(...minutes) - Math.min(...minutes);
  if (gap > (pair ? CLOSE_PAIR : CLOSE_GROUP)) return null;
  const who = pair ? OG_TEXT.banbanPair : OG_TEXT.banbanGroup;
  if (gap === 0) return `${OG_TEXT.banbanCloseLead}${who}${OG_TEXT.banbanSame}`;
  return `${OG_TEXT.banbanCloseLead}${who}${formatMinutes(gap)}${pair ? OG_TEXT.banbanPairTail : OG_TEXT.banbanGroupTail}`;
}

/**
 * 공평 기준에서 모두가 갈 수 있을 때만 값이 있다. 출발역을 숨긴 사람이 있으면 없다: 본인은 정확한 시간을, 남은 5분 단위로 올린
 * 시간을 보므로 같은 방에서 말이 갈린다.
 */
export function banbanLine(input: {
  mode: Mode;
  minutes: readonly (number | null)[];
  hidden: boolean;
}): BanbanLine | null {
  const { mode, minutes, hidden } = input;
  if (hidden || mode !== "fair" || minutes.length < 2 || minutes.some((m) => m === null)) return null;
  const shown = minutes as readonly number[];
  const close = closeText(shown);
  if (close !== null) return { kind: "close", text: close };
  return {
    kind: "longest",
    text: `${OG_TEXT.banbanLongestLead}${formatMinutes(Math.max(...shown))}${OG_TEXT.banbanLongestTail}`,
  };
}

/**
 * 방 미리보기에는 숨김 표시가 없다. 숨긴 사람의 시간은 300초의 배수로 오므로, 그런 시간이 하나라도 있으면 숨긴 사람이 있을 수 있다고
 * 본다. 숨긴 0초도 300초가 되므로 0초는 공개 시간이다.
 */
export function mayIncludeHidden(seconds: readonly (number | null)[]): boolean {
  return seconds.some((s) => s !== null && s > 0 && s % HIDDEN_STEP_SECONDS === 0);
}
