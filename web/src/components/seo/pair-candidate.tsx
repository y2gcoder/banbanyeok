import { LineBadges } from "@/components/common/line-badge";
import { personColor } from "@/components/common/person-color";
import { formatMinutes, transferLabel } from "@/lib/display/minutes";
import type { PairCandidate } from "@/lib/seo/pair-pages";

function Rails({ candidate }: { candidate: PairCandidate }) {
  const max = candidate.aggregate.max;
  return (
    <ul className="flex flex-col gap-3">
      {candidate.people.map((person, index) => {
        const ratio = max === 0 ? 1 : Math.max(person.minutes / max, 0.06);
        return (
          <li
            key={person.stationName}
            className="grid grid-cols-[minmax(4.5rem,auto)_1fr_auto] items-center gap-x-3 gap-y-0.5"
          >
            <span className="truncate text-[15px] font-bold text-ink">{person.stationName}</span>
            <span aria-hidden="true" className="relative flex h-3 items-center">
              <span className="absolute inset-x-0 h-[3px] rounded-full bg-rule" />
              <span
                className="relative h-[5px] rounded-full"
                style={{ width: `${ratio * 100}%`, backgroundColor: personColor(index) }}
              />
              <span
                className="relative -ml-1 size-3 shrink-0 rounded-full border-[3px] bg-surface"
                style={{ borderColor: personColor(index) }}
              />
            </span>
            <span className="tabular text-right text-[22px] leading-none font-extrabold tracking-tight text-ink">
              {formatMinutes(person.minutes)}
            </span>
            <span className="col-start-2 col-end-4 text-right text-[13px] text-muted-foreground">
              {transferLabel(person.transfers)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** 조합 페이지의 후보 한 곳: 역, 사람(출발역)별 시간·환승, 최장·차이·합계, 이유 문장. 이유는 파이프라인이 만든 문장 그대로다. */
export function PairCandidateCard({ candidate }: { candidate: PairCandidate }) {
  const { max, spread, total } = candidate.aggregate;
  const top = candidate.rank === 1;
  return (
    <li>
      <article
        aria-labelledby={`pair-cand-${candidate.rank}`}
        className="flex flex-col gap-4 rounded-2xl border border-rule bg-surface p-5 shadow-[0_1px_0_var(--rule)]"
      >
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span
            className={
              top
                ? "tabular rounded-sm bg-safety px-1.5 py-0.5 text-[13px] font-bold text-safety-ink"
                : "tabular flex size-7 items-center justify-center rounded-full border-2 border-ink text-[13px] font-extrabold text-ink"
            }
          >
            {top ? "1위" : candidate.rank}
          </span>
          <h3
            id={`pair-cand-${candidate.rank}`}
            className="text-[26px] leading-none font-extrabold tracking-[-0.02em] text-ink"
          >
            {candidate.station.label}
          </h3>
          <LineBadges lines={candidate.station.lines} />
        </header>
        <Rails candidate={candidate} />
        <dl className="grid grid-cols-3 divide-x divide-rule rounded-lg bg-platform/70 py-2.5">
          {[
            ["최장", max],
            ["차이", spread],
            ["합계", total],
          ].map(([label, value]) => (
            <div key={label} className="flex flex-col items-center gap-0.5">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="tabular text-[15px] font-bold text-ink">{formatMinutes(Number(value))}</dd>
            </div>
          ))}
        </dl>
        <p className="border-l-4 border-safety pl-3 text-[15px] leading-relaxed text-ink">
          <span className="sr-only">추천 이유: </span>
          {candidate.reason}
        </p>
      </article>
    </li>
  );
}
