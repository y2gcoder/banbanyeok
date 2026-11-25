"use client";

import { useEffect, useState } from "react";
import { BANBAN_PARAM, type BanbanPlan, banbanIndex, banbanPlan } from "@/lib/result/banban-index";
import type { ResultView } from "@/lib/result/view-model";
import { OtherCandidateRow, TopCandidateCard } from "./candidate-card";
import type { ChoiceContext } from "./directions";

// 결과 화면과 방 화면이 같이 쓰는 조각: 후보 목록·로딩 카드·두 칸 배치 클래스.

/**
 * 결과 화면 배치. 폰은 한 칸(위에서 아래로: 머리 → 기준 탭 → 후보 → 공유). 두 칸 폭(wide)부터는 왼쪽 칸에 머리·기준 탭·공유를,
 * 오른쪽 칸에 후보(탭 패널)를 둔다. 문서 순서는 폰 순서 그대로라 탭 → 패널 → 공유로 읽히고, 왼쪽 칸 항목은 1~3행, 패널은
 * 오른쪽 칸 1~4행을 차지한다(마지막 행이 남는 높이를 받아 왼쪽 항목이 위로 모인다).
 */
export const RESULT_GRID =
  "hinge-split mx-auto grid min-h-dvh w-full max-w-md content-start gap-5 px-gutter pt-4 pb-10 wide:max-w-6xl wide:grid-cols-2 wide:grid-rows-[auto_auto_auto_1fr] wide:gap-x-6 wide:pt-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-x-12";
/** 왼쪽 칸 항목. */
export const SIDE = "wide:col-start-1";
/** 오른쪽 칸(후보). */
export const PANEL = "wide:col-start-2 wide:row-span-4 wide:row-start-1";

/** 반반지수 시안(#202): 주소의 `bbi=`로 안을 고른다. 수화 뒤에 읽어 서버 그림과 어긋나지 않게 한다. */
function useBanbanPlan(): BanbanPlan | null {
  const [plan, setPlan] = useState<BanbanPlan | null>(null);
  useEffect(() => {
    setPlan(banbanPlan(new URLSearchParams(window.location.search).get(BANBAN_PARAM)));
  }, []);
  return plan;
}

export function LoadingCard() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 2500);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div role="status" className="flex flex-col gap-4 rounded-2xl border border-rule bg-surface p-5">
      <div className="h-8 w-32 motion-safe:animate-pulse rounded-md bg-muted" />
      <div className="h-3 w-full motion-safe:animate-pulse rounded-full bg-muted" />
      <div className="h-3 w-4/5 motion-safe:animate-pulse rounded-full bg-muted" />
      <p className="text-[15px] text-ink-soft">
        {slow ? "서버를 깨우는 중이에요. 몇 초만 기다려 주세요." : "만날 역 고르는 중"}
      </p>
    </div>
  );
}

export function Candidates({
  view,
  meIndex,
  choice,
}: {
  view: ResultView;
  meIndex: number | null;
  choice: ChoiceContext;
}) {
  const [top, ...rest] = view.candidates;
  const plan = useBanbanPlan();
  if (!top) return null;
  const banban = banbanIndex(
    plan,
    view.mode,
    top.aggregate.minutes,
    rest.map((c) => c.aggregate.minutes),
  );
  return (
    <>
      <TopCandidateCard candidate={top} choice={choice} meIndex={meIndex} mapMiddle={view.mapMiddle} banban={banban} />
      {rest.length > 0 ? (
        <section aria-label="다른 후보" className="overflow-hidden rounded-2xl border border-rule bg-surface">
          {rest.map((candidate) => (
            <OtherCandidateRow key={candidate.stationCode} candidate={candidate} choice={choice} meIndex={meIndex} />
          ))}
        </section>
      ) : null}
    </>
  );
}
