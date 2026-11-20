import { ChevronRightIcon } from "lucide-react";
import { useId } from "react";
import { personColor } from "@/components/common/person-color";
import { buttonVariants } from "@/components/ui/button";
import { type LastTrainRow, type LastTrainTime, type LastTrainView, marginNote } from "@/lib/result/last-train";
import { parenSafe } from "@/lib/text/paren-safe";
import { cn } from "@/lib/utils";

const mapButton = cn(
  buttonVariants({ variant: "outline" }),
  "mt-0.5 h-11 w-full rounded-lg text-[14px] font-semibold wide:w-auto wide:self-start wide:px-4",
);

/** 시계 숫자는 한 덩어리로 둔다(좁은 화면에서 "00:"과 "03"이 갈리지 않게). */
function Clock({ time }: { time: LastTrainTime }) {
  return (
    <span className="tabular text-[22px] leading-none font-extrabold tracking-tight whitespace-nowrap text-ink">
      {time.clock}
    </span>
  );
}

/** 자정을 넘긴 시각 옆의 작은 표시. 숫자만 보면 "00:03"이 그날 새벽인지 헷갈린다. */
function NextDay() {
  return (
    <span className="rounded-sm bg-platform px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap text-ink-soft">
      다음 날
    </span>
  );
}

/**
 * 여유 시각·확인 필요·약속 전에 떠나는 줄에 두는 버튼. 카카오맵 대중교통 길찾기를 만날 역 → 그 사람의 출발역 방향으로 연다(누를 때만 열린다).
 * 지도 앱 링크로는 막차나 출발 시각을 정할 수 없어 "정확한 막차"라고 약속하지 않는다. 통계는 보내지 않는다.
 */
function MapLink({ row }: { row: LastTrainRow }) {
  if (!row.mapUrl) return null;
  return (
    <a
      href={row.mapUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={mapButton}
      aria-label={`${row.name}, 지도 앱에서 막차 확인하기`}
    >
      지도 앱에서 막차 확인하기
    </a>
  );
}

function Detail({ row, view }: { row: LastTrainRow; view: LastTrainView }) {
  const { state } = row;
  const note = "text-[13px] leading-snug break-keep text-muted-foreground";
  const plain = "text-[14px] leading-snug break-keep text-ink-soft";
  if (state.kind === "same") return <p className={note}>출발역이 바로 이 역이에요.</p>;
  if (state.kind === "check") {
    return (
      <>
        {view.checkReason ? <p className={plain}>{parenSafe(view.checkReason)}</p> : null}
        <MapLink row={row} />
      </>
    );
  }
  if (state.kind === "gone") {
    return (
      <>
        <p className={plain}>{parenSafe(state.text)}</p>
        <MapLink row={row} />
      </>
    );
  }
  if (state.kind === "direct") {
    return (
      <>
        <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-[15px] font-semibold text-ink">
          <span>막차</span>
          <Clock time={state} />
          {state.nextDay ? <NextDay /> : null}
          {state.bound ? <span className="break-keep">· {parenSafe(state.bound)}</span> : null}
        </p>
        <p className={note}>{parenSafe(`${view.stationName}에서 열차가 떠나는 시각이에요.`)}</p>
      </>
    );
  }
  return (
    <>
      <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-[15px] font-semibold text-ink">
        <span>늦어도</span>
        {state.nextDay ? <NextDay /> : null}
        <span className="whitespace-nowrap">
          <Clock time={state} />엔
        </span>
        <span>출발하세요</span>
      </p>
      <p className={note}>{parenSafe(marginNote(state))}</p>
      <MapLink row={row} />
    </>
  );
}

/**
 * 후보 카드 안의 "집에 가는 막차" 칸(#62). 가는 길(사람별 시간 막대)과 섞지 않고 따로 둔다: 이 칸은 돌아오는 길이다.
 * 맨 위 한 줄은 공개된 시각 가운데 가장 이른 것이고(계산하지 못한 응답이면 그 이유), 사람마다 직행 확정(분 그대로) / 여유 시각(10분 단위로
 * 내린 값) / 확인 필요(시각 없이 이유) / 약속 전에 떠남으로 보인다. 사람 색은 막대에만 쓰고 글자는 ink/muted만 쓴다(globals.css 규칙).
 *
 * 펼친 채로 시작하고 제목을 눌러 접을 수 있다(4명이면 칸이 한 화면을 넘는다: 접으면 바로 아래의 역 정하기에 닿는다).
 * 영역 이름에는 역 이름을 넣는다("금정역 집에 가는 막차"): 후보를 여러 개 펼쳐도 영역이 서로 구분된다.
 */
export function LastTrains({ view, meIndex = null }: { view: LastTrainView; meIndex?: number | null }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="border-t border-rule pt-1.5">
      <details open className="group/last">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
          <h3 id={headingId} className="text-[15px] font-bold text-ink">
            <span className="sr-only">{view.stationName}</span> 집에 가는 막차
          </h3>
          {view.dayLabel ? (
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">{view.dayLabel} 시간표</span>
          ) : null}
          <ChevronRightIcon
            className={cn(
              "size-5 shrink-0 text-muted-foreground motion-safe:transition-transform group-open/last:rotate-90",
              view.dayLabel ? null : "ml-auto",
            )}
            aria-hidden="true"
          />
        </summary>
        <div className="flex flex-col gap-3 pt-1.5">
          {view.notice ? (
            <p className="rounded-lg bg-platform/70 px-3 py-2 text-[14px] leading-snug font-semibold break-keep text-ink">
              {parenSafe(view.notice)}
            </p>
          ) : null}
          {view.lead ? (
            <p className="rounded-lg bg-safety/25 px-3 py-2 text-[15px] leading-snug font-bold break-keep text-ink">
              {parenSafe(view.lead)}
            </p>
          ) : null}
          {view.rows.length > 0 ? (
            <ul className="flex flex-col gap-3.5">
              {view.rows.map((row) => (
                <li key={row.index} className="flex flex-col gap-1.5">
                  <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
                    <span
                      aria-hidden="true"
                      className="h-3.5 w-1.5 shrink-0 self-center rounded-full"
                      style={{ backgroundColor: personColor(row.index) }}
                    />
                    <span className="text-[15px] font-bold break-all text-ink">
                      {row.name}
                      {row.index === meIndex ? (
                        <span className="ml-1 text-xs font-semibold text-muted-foreground">(나)</span>
                      ) : null}
                    </span>
                    {row.onlyMe ? <span className="text-xs text-muted-foreground">나에게만 보여요</span> : null}
                  </p>
                  <Detail row={row} view={view} />
                </li>
              ))}
            </ul>
          ) : null}
          {view.hiddenOthers ? (
            <p className="text-[13px] leading-snug break-keep text-muted-foreground">
              출발역을 숨긴 분의 막차는 본인 화면에서만 보여요.
            </p>
          ) : null}
          {view.partialNote ? (
            <p className="text-[13px] leading-snug break-keep text-ink-soft">{parenSafe(view.partialNote)}</p>
          ) : null}
          {view.footnote ? (
            <p className="text-[13px] leading-snug break-keep text-muted-foreground">{parenSafe(view.footnote)}</p>
          ) : null}
        </div>
      </details>
    </section>
  );
}
