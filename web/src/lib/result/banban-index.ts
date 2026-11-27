/**
 * 반반지수(#202): 공평 1위가 왜 공평한지 말하는 한 줄. 공평 순위는 가장 오래 걸리는 사람의 시간이 가장 짧은 역을 고르므로(minimax),
 * 기본 층은 늘 그 시간을 말한다("가장 오래 걸리는 사람도 38분이에요", 1시간부터는 "가장 오래 걸리는 사람 1시간 34분"). 걸리는 시간이 고를 때만
 * 그 줄을 강조 층으로 바꾼다
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
/** 기본 층을 명사형으로 바꾸는 최장 시간(분, 화면 값). 1시간이 넘으면 '도'가 '겨우'처럼 읽힌다(운영자 결정 14, 2026-11-26). */
const NOUN_FROM_MINUTES = 60;

function closeText(minutes: readonly number[]): string | null {
  const pair = minutes.length === 2;
  const gap = Math.max(...minutes) - Math.min(...minutes);
  if (gap > (pair ? CLOSE_PAIR : CLOSE_GROUP)) return null;
  const who = pair ? OG_TEXT.banbanPair : OG_TEXT.banbanGroup;
  if (gap === 0) return `${OG_TEXT.banbanCloseLead}${who}${OG_TEXT.banbanSame}`;
  return `${OG_TEXT.banbanCloseLead}${who}${formatMinutes(gap)}${pair ? OG_TEXT.banbanPairTail : OG_TEXT.banbanGroupTail}`;
}

/**
 * 공평 기준에서 모두가 갈 수 있을 때만 값이 있다.
 */
export function banbanLine(input: { mode: Mode; minutes: readonly (number | null)[] }): BanbanLine | null {
  const { mode, minutes } = input;
  if (mode !== "fair" || minutes.length < 2 || minutes.some((m) => m === null)) return null;
  const shown = minutes as readonly number[];
  const close = closeText(shown);
  if (close !== null) return { kind: "close", text: close };
  const longest = Math.max(...shown);
  const text =
    longest < NOUN_FROM_MINUTES
      ? `${OG_TEXT.banbanLongestLead}${formatMinutes(longest)}${OG_TEXT.banbanLongestTail}`
      : `${OG_TEXT.banbanLongestNoun}${formatMinutes(longest)}`;
  return { kind: "longest", text };
}
