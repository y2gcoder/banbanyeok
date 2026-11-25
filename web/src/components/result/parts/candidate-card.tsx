"use client";

import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useId, useState } from "react";
import { LineBadges } from "@/components/common/line-badge";
import { personColor } from "@/components/common/person-color";
import type { Mode } from "@/lib/api/types";
import { formatMinutes } from "@/lib/display/minutes";
import type { BanbanIndex } from "@/lib/result/banban-index";
import { lastTrainSummary } from "@/lib/result/last-train";
import type { MapMiddleView } from "@/lib/result/map-middle";
import type { CandidateView } from "@/lib/result/view-model";
import { parenSafe } from "@/lib/text/paren-safe";
import { cn } from "@/lib/utils";
import { type ChoiceContext, Directions } from "./directions";
import { LastTrains } from "./last-trains";
import { MapMiddleCompare } from "./map-middle-compare";
import { originNote, shownTransferLabel, TimeRails } from "./time-rails";

/** 환승역 기호(굵은 고리). 1위 표시. */
function TransferRing() {
  return (
    <svg viewBox="0 0 28 28" className="size-7 shrink-0" aria-hidden="true">
      <circle cx="14" cy="14" r="10.5" fill="var(--surface)" stroke="var(--ink)" strokeWidth="5" />
    </svg>
  );
}

/**
 * 순위를 정한 값만 한 줄로(#122). 공평하게·누구 쪽으로는 최장·차이, 빨리 만나기는 합계가 기준이라 합계를 앞에 둔다.
 * 공평 순위(최장)와 상관없는 합계는 빨리 만나기에서만 보인다(4명 시간 합계는 무엇을 뜻하는지 읽히지 않는다는 피드백).
 */
function keyStats(candidate: CandidateView, mode: Mode): { label: string; value: number }[] {
  const { max, spread, total } = candidate.aggregate;
  return mode === "fast"
    ? [
        { label: "합계", value: total },
        { label: "최장", value: max },
      ]
    : [
        { label: "최장", value: max },
        { label: "차이", value: spread },
      ];
}

function StatLine({ candidate, mode }: { candidate: CandidateView; mode: Mode }) {
  const items = keyStats(candidate, mode);
  return (
    <dl className="tabular flex flex-wrap gap-x-3 gap-y-1 text-[14px] text-ink-soft">
      {items.map((item) => (
        <div key={item.label} className="flex gap-1">
          <dt>{item.label}</dt>
          <dd className="font-bold text-ink">{formatMinutes(item.value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function Reason({ text }: { text: string }) {
  return (
    <p className="border-l-4 border-safety pl-3 text-[15px] leading-relaxed text-ink">
      <span className="sr-only">추천 이유: </span>
      {text}
    </p>
  );
}

function TopHeader({ candidate }: { candidate: CandidateView }) {
  return (
    <header className="flex items-start gap-3">
      <TransferRing />
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="flex items-center gap-2 text-[13px] font-bold text-safety-ink">
          <span className="rounded-sm bg-safety px-1.5 py-0.5">1위</span>
          <LineBadges lines={candidate.lines} />
        </p>
        <h2
          id={`cand-${candidate.rank}`}
          // 카드 폭에 맞춰 글자를 줄인다(좁은 칸에서도 "동대문역사문화공원"이 한 줄에 들어가게). 넓으면 34px.
          className="text-[clamp(24px,8.5cqi,34px)] leading-none font-extrabold tracking-[-0.03em] text-ink"
        >
          {candidate.stationName}
        </h2>
      </div>
    </header>
  );
}

type TopProps = {
  candidate: CandidateView;
  choice: ChoiceContext;
  meIndex?: number | null;
  /** 보여 줄 조건을 모두 만족할 때만 값이 있다(`ResultView.mapMiddle`). 없으면 비교 표가 빠진다. */
  mapMiddle?: MapMiddleView | null;
  banban?: BanbanIndex | null;
};

/**
 * 반반지수 시안(#202): 등급 말(좋은 두 등급은 노란 칩) + 무엇을 쟀는지 한 줄. 기울었으면 공평 순위가 그 역을 고른 이유를 붙인다.
 * 사실 문장 안은 문장 하나를 노란 칩으로 그린다.
 */
function BanbanLine({ banban }: { banban: BanbanIndex }) {
  if (banban.kind === "fact") {
    return (
      <p>
        <span className="rounded-full bg-safety px-2.5 py-0.5 text-[14px] font-extrabold text-ink">
          {banban.sentence}
        </span>
      </p>
    );
  }
  const good = banban.grade === "even" || banban.grade === "near";
  return (
    <div className="flex flex-col gap-1">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 text-[14px] font-extrabold text-ink",
            good ? "bg-safety" : "bg-muted",
          )}
        >
          {banban.label}
        </span>
        <span className="text-[14px] text-ink-soft">{banban.detail}</span>
      </p>
      {banban.grade === "tilted" ? (
        <p className="text-[13px] text-muted-foreground">대신 가장 오래 걸리는 사람의 시간이 가장 짧은 곳이에요</p>
      ) : null}
    </div>
  );
}

const topCard =
  "@container flex flex-col gap-4 rounded-2xl border border-rule bg-surface p-5 shadow-[0_1px_0_var(--rule)]";

/** 1위 요약의 사람별 시간: 막대 없이 한 사람 한 줄(이름 · 환승 · 분). 내가 누구인지 고른 화면이면 나를 맨 위에. */
function TimeList({ candidate, meIndex }: { candidate: CandidateView; meIndex: number | null }) {
  const ordered =
    meIndex === null
      ? candidate.people
      : [...candidate.people].sort((a, b) => Number(b.index === meIndex) - Number(a.index === meIndex));
  return (
    <ul className="flex flex-col gap-1.5">
      {ordered.map((person) => (
        <li key={person.index} className="flex items-baseline gap-2">
          <span
            aria-hidden="true"
            className="h-3.5 w-1.5 shrink-0 self-center rounded-full"
            style={{ backgroundColor: personColor(person.index) }}
          />
          <span className="min-w-0 truncate text-[15px] font-bold text-ink">
            {person.shortName}
            {person.index === meIndex ? (
              <span className="ml-1 text-xs font-semibold text-muted-foreground">(나)</span>
            ) : null}
          </span>
          <span className="min-w-0 shrink-[2] truncate text-[13px] text-muted-foreground">
            {[originNote(person), shownTransferLabel(person)].filter(Boolean).join(" · ")}
          </span>
          <span className="tabular ml-auto shrink-0 text-[19px] leading-none font-extrabold text-ink">
            {formatMinutes(person.minutes)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * 1위 카드(#122). 2·3위처럼 요약이 먼저다: 역 이름, 사람별 분, 순위 기준 값, 가장 이른 막차 한 줄, 정하기·길찾기가 폰 첫 화면에 들어온다.
 * 시간 막대·추천 이유·막차 자세히·지도 한가운데 비교는 "자세히"에서 펼친다. 막차는 접혀 있어도 요약 한 줄(`lastTrainSummary`)이 보인다.
 */
export function TopCandidateCard({ candidate, choice, meIndex = null, mapMiddle = null, banban = null }: TopProps) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  return (
    <article aria-labelledby={`cand-${candidate.rank}`} className={topCard}>
      <TopHeader candidate={candidate} />
      {banban ? <BanbanLine banban={banban} /> : null}
      <TimeList candidate={candidate} meIndex={meIndex} />
      <div className="flex flex-col gap-1.5 border-t border-rule pt-3">
        <StatLine candidate={candidate} mode={choice.mode} />
        {candidate.lastTrain ? (
          <p className="text-[14px] leading-snug break-keep text-ink">
            <span className="mr-1.5 text-ink-soft">막차</span>
            <span className="font-bold">{parenSafe(lastTrainSummary(candidate.lastTrain))}</span>
          </p>
        ) : null}
      </div>
      <Directions candidate={candidate} choice={choice} meIndex={meIndex} />
      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={() => setOpen((v) => !v)}
        className="-mx-2 -mb-2 flex min-h-11 items-center justify-center gap-1 rounded-md text-[14px] font-semibold text-ink-soft hover:bg-accent"
      >
        {/* 이름은 고정이다(상태는 aria-expanded가 말한다). */}
        자세히: 시간 막대·추천 이유·막차
        <ChevronDownIcon
          className={cn("size-4 motion-safe:transition-transform", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      <div id={detailId} hidden={!open} className="flex flex-col gap-4">
        <TimeRails
          people={candidate.people}
          maxMinutes={candidate.aggregate.max}
          meIndex={meIndex}
          size="compact"
          rank={candidate.rank}
        />
        <Reason text={candidate.reason} />
        {candidate.lastTrain ? <LastTrains view={candidate.lastTrain} meIndex={meIndex} /> : null}
        {mapMiddle ? <MapMiddleCompare candidate={candidate} middle={mapMiddle} /> : null}
      </div>
    </article>
  );
}

/** 2·3위: 접힌 줄에 순위 기준 값(1위와 같은 `keyStats`), 펼치면 사람별 시간과 이유, 집에 가는 막차. */
export function OtherCandidateRow({
  candidate,
  choice,
  meIndex = null,
}: {
  candidate: CandidateView;
  choice: ChoiceContext;
  meIndex?: number | null;
}) {
  const { max } = candidate.aggregate;
  return (
    <details className="group border-t border-rule first:border-t-0">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5 [&::-webkit-details-marker]:hidden">
        <span className="tabular flex size-7 shrink-0 items-center justify-center rounded-full border-2 border-ink text-[13px] font-extrabold text-ink">
          {candidate.rank}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[17px] font-bold text-ink">{candidate.stationName}</span>
            <LineBadges lines={candidate.lines} />
          </span>
          <span className="tabular text-[13px] text-muted-foreground">
            {keyStats(candidate, choice.mode)
              .map((item) => `${item.label} ${formatMinutes(item.value)}`)
              .join(", ")}
          </span>
        </span>
        <ChevronRightIcon
          className="size-5 shrink-0 text-muted-foreground motion-safe:transition-transform group-open:rotate-90"
          aria-hidden="true"
        />
      </summary>
      <div className="flex flex-col gap-4 px-4 pt-1 pb-4">
        <TimeRails people={candidate.people} maxMinutes={max} meIndex={meIndex} size="compact" rank={candidate.rank} />
        <Reason text={candidate.reason} />
        {candidate.lastTrain ? <LastTrains view={candidate.lastTrain} meIndex={meIndex} /> : null}
        <Directions candidate={candidate} choice={choice} meIndex={meIndex} />
      </div>
    </details>
  );
}
