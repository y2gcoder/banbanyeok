/**
 * 공유 링크 그림 "A 숫자판"(`/s/og`)에 넘기는 값. 이름은 글꼴에 있는 글자로 거른 값(`sharedCardData`)이고,
 * 차이·칭호·지도 한가운데 비교 문장은 화면 숫자(반올림한 분)에서 계산한다. 그림의 입력이라 `SHARED_OG_IMAGE_VERSION`의 해시에 든다.
 */

import type { ShareState } from "@/lib/link/codec";
import { type BanbanIndex, type BanbanPlan, banbanIndex } from "@/lib/result/banban-index";
import { evenTitle, mapMiddleSentence } from "@/lib/result/map-middle";
import type { ResultView } from "@/lib/result/view-model";
import { basisText, type SharedCardData, sharedCardData } from "./shared-preview";

export type ScoreboardCardData = SharedCardData & {
  /** 가장 오래 걸리는 사람과 가장 짧은 사람의 차이(분). 갈 수 없는 사람이 있으면 null. */
  spread: number | null;
  /** 차이가 아주 작을 때의 칭호("완벽한 반반"). 공평 기준에서만. */
  title: string | null;
  /** 지도 한가운데 비교 문장. 있으면 맨 아래 줄이 이 문장이다. */
  compareLine: string | null;
  /** 평일 낮이 아닌 기준("토요일 밤 기준"). 비교 문장이 아래 줄을 차지할 때 차이 줄 옆에 둔다. */
  basisLine: string | null;
  /** 반반지수 시안(#202). 있으면 "차이" 칩과 칭호 자리에 이 값의 설명과 등급 말을 그린다. */
  banban: BanbanIndex | null;
};

export function scoreboardCardData(
  view: ResultView,
  state: ShareState,
  plan: BanbanPlan | null = null,
): ScoreboardCardData | null {
  const base = sharedCardData(view, state);
  if (!base) return null;
  const minutes = base.people.flatMap((p) => (p.minutes === null ? [] : [p.minutes]));
  const spread = minutes.length === base.people.length ? Math.max(...minutes) - Math.min(...minutes) : null;
  const middle = view.mapMiddle;
  const name = middle ? base.people[middle.personIndex]?.name : undefined;
  return {
    ...base,
    spread,
    title: spread === null ? null : evenTitle(view.mode, spread, minutes.length),
    compareLine: middle && name ? mapMiddleSentence(view, name) : null,
    basisLine: basisText(view),
    banban: banbanIndex(plan, {
      mode: view.mode,
      top: base.people.map((p) => p.minutes),
      others: view.candidates.slice(1).map((c) => c.aggregate.minutes),
      hidden: view.anyHidden === true,
    }),
  };
}
