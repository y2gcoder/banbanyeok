import { ChevronRightIcon } from "lucide-react";
import { LineBadges } from "@/components/common/line-badge";
import { formatMinutes } from "@/lib/display/minutes";
import type { CandidateView } from "@/lib/result/view-model";
import { Directions } from "./directions";
import { TimeRails } from "./time-rails";

/** 환승역 기호(굵은 고리). 1위 표시. */
function TransferRing() {
  return (
    <svg viewBox="0 0 28 28" className="size-7 shrink-0" aria-hidden="true">
      <circle cx="14" cy="14" r="10.5" fill="var(--surface)" stroke="var(--ink)" strokeWidth="5" />
    </svg>
  );
}

function Stats({ candidate }: { candidate: CandidateView }) {
  const { max, spread, total } = candidate.aggregate;
  const items = [
    { label: "최장", value: max },
    { label: "차이", value: spread },
    { label: "합계", value: total },
  ];
  return (
    <dl className="grid grid-cols-3 divide-x divide-rule rounded-lg bg-platform/70 py-2.5">
      {items.map((item) => (
        <div key={item.label} className="flex flex-col items-center gap-0.5">
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd className="tabular text-[15px] font-bold text-ink">{formatMinutes(item.value)}</dd>
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

/** 1위 카드: 역 이름을 크게, 사람별 시간을 막대와 숫자로. */
export function TopCandidateCard({ candidate, meIndex = null }: { candidate: CandidateView; meIndex?: number | null }) {
  return (
    <article
      aria-labelledby={`cand-${candidate.rank}`}
      className="flex flex-col gap-5 rounded-2xl border border-rule bg-surface p-5 shadow-[0_1px_0_var(--rule)]"
    >
      <header className="flex items-start gap-3">
        <TransferRing />
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="text-[13px] font-bold text-safety-ink">
            <span className="rounded-sm bg-safety px-1.5 py-0.5">1위</span>
          </p>
          <h2
            id={`cand-${candidate.rank}`}
            className="text-[34px] leading-none font-extrabold tracking-[-0.03em] text-ink"
          >
            {candidate.stationName}
          </h2>
          <LineBadges lines={candidate.lines} />
        </div>
      </header>
      <TimeRails people={candidate.people} maxMinutes={candidate.aggregate.max} meIndex={meIndex} />
      <Stats candidate={candidate} />
      <Reason text={candidate.reason} />
      <Directions candidate={candidate} meIndex={meIndex} />
    </article>
  );
}

/** 2·3위: 접힌 줄에 최장·차이, 펼치면 사람별 시간과 이유. */
export function OtherCandidateRow({
  candidate,
  meIndex = null,
}: {
  candidate: CandidateView;
  meIndex?: number | null;
}) {
  const { max, spread } = candidate.aggregate;
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
            최장 {formatMinutes(max)}, 차이 {formatMinutes(spread)}
          </span>
        </span>
        <ChevronRightIcon
          className="size-5 shrink-0 text-muted-foreground motion-safe:transition-transform group-open:rotate-90"
          aria-hidden="true"
        />
      </summary>
      <div className="flex flex-col gap-4 px-4 pt-1 pb-4">
        <TimeRails people={candidate.people} maxMinutes={max} meIndex={meIndex} size="compact" />
        <Reason text={candidate.reason} />
        <Directions candidate={candidate} meIndex={meIndex} />
      </div>
    </details>
  );
}
