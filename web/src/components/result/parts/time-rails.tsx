import { RouteIcon } from "lucide-react";
import { Fragment } from "react";
import { track } from "@/lib/analytics";
import { formatMinutes, transferLabel } from "@/lib/display/minutes";
import type { RouteView } from "@/lib/result/route";
import type { PersonTimeView } from "@/lib/result/view-model";
import { lineColor } from "@/lib/stations/lines";

/** 환승 글. 환승 수가 없으면 표시하지 않는다. */
export function shownTransferLabel(person: Pick<PersonTimeView, "shownTransfers">): string | null {
  return person.shownTransfers === null ? null : transferLabel(person.shownTransfers);
}

/** 이름 옆 보조 줄. 이름이 출발역 이름이면 같은 말을 되풀이하지 않는다. */
export function originNote(person: PersonTimeView): string | null {
  if (!person.originName) return "출발역 비공개";
  return person.labelKind === "origin" ? null : `${person.originName}에서`;
}

/**
 * 눈금. 모든 사람의 트랙이 같은 눈금(0분 ~ `end`분)을 쓴다. 끝은 최장 시간을 눈금 간격으로 올린 값이라
 * "가장 오래 걸리는 사람 = 끝"이 아니라 자처럼 읽힌다(31분 → 0·10·20·30·40분). 길면 간격을 넓혀 숫자가 겹치지 않게 한다.
 */
export function railScale(maxMinutes: number): { end: number; step: number } {
  const step = maxMinutes <= 60 ? 10 : maxMinutes <= 120 ? 20 : 30;
  return { end: Math.max(step, Math.ceil(maxMinutes / step) * step), step };
}

function percent(minutes: number, end: number): string {
  return `${(Math.min(minutes, end) / end) * 100}%`;
}

function Ticks({ end, step }: { end: number; step: number }) {
  const ticks: number[] = [];
  for (let value = step; value < end; value += step) ticks.push(value);
  return ticks.map((value) => (
    <span
      key={value}
      className="absolute top-[3px] h-2 w-0.5 -translate-x-1/2 rounded-full bg-rule-strong"
      style={{ left: percent(value, end) }}
    />
  ));
}

/**
 * 경로가 있으면 막대를 구간으로 나눠 칠한다(#120): 탄 노선은 노선 색, 승강장 대기·갈아타기(걷기 + 대기)는 회색. 구간 길이는 모델 시간의
 * 비율이고 막대 전체 길이는 그 사람의 분(od 값)이다. 구간 시간은 숫자로 쓰지 않는다(배차/2 평균이라 실제 시간표와 다르다).
 */
function RouteFill({ route, width }: { route: RouteView; width: string }) {
  const total = route.segments.reduce((sum, segment) => sum + segment.seconds, 0);
  return (
    <span className="absolute top-[4.5px] left-0 flex h-[5px] gap-px overflow-hidden rounded-full" style={{ width }}>
      {route.segments.map((segment, i) => (
        <span
          // 구간 순서가 곧 정체다(같은 노선을 두 번 탈 수 있다).
          // biome-ignore lint/suspicious/noArrayIndexKey: 순서가 바뀌지 않는 고정 목록
          key={i}
          data-segment={segment.kind}
          className={segment.kind === "wait" ? "h-full shrink-0 bg-rule-strong" : "h-full shrink-0"}
          style={{
            width: `${(segment.seconds / total) * 100}%`,
            backgroundColor: segment.kind === "ride" ? lineColor(segment.line) : undefined,
          }}
        />
      ))}
    </span>
  );
}

/** 경로를 모르면(서버가 주지 않음) 막대와 끝점은 중립색이다. 역의 호선 배지와 헷갈리지 않게 한다. */
function Track({ person, end, step }: { person: PersonTimeView; end: number; step: number }) {
  const at = percent(person.minutes, end);
  const last = person.route?.lines.at(-1);
  return (
    <span aria-hidden="true" className="relative block h-3.5" data-route={person.route ? "lines" : "neutral"}>
      <span className="absolute inset-x-0 top-[5.5px] h-[3px] rounded-full bg-rule" />
      <Ticks end={end} step={step} />
      {person.route ? (
        <RouteFill route={person.route} width={at} />
      ) : (
        <span className="absolute top-[4.5px] left-0 h-[5px] rounded-full bg-ink-soft" style={{ width: at }} />
      )}
      <span
        className="absolute top-px size-3 -translate-x-1/2 rounded-full border-[3px] border-ink-soft bg-surface"
        style={{ left: at, borderColor: last ? lineColor(last) : undefined }}
      />
    </span>
  );
}

/**
 * 막대 아래 경로 글: 노선 점 + "2호선 → 동대문역사문화공원 환승 → 4호선". 화면 읽기는 막대(aria-hidden) 대신 이 글을 읽는다.
 * 정확한 열차 시각·출구는 카카오맵 길찾기가 보여 주므로 같은 줄에 연결을 둔다.
 */
function RouteLine({ person, rank }: { person: PersonTimeView; rank: number | undefined }) {
  const route = person.route;
  if (!route) return null;
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <p className="text-[13px] leading-snug break-keep text-ink-soft">
        <span className="sr-only">
          {person.shortName} 경로: {route.description}
        </span>
        <span aria-hidden="true" className="inline-flex flex-wrap items-center gap-x-1 gap-y-0.5">
          {route.lines.map((line, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 순서가 바뀌지 않는 고정 목록(같은 노선을 두 번 탈 수 있다)
            <Fragment key={i}>
              {i > 0 ? <span className="text-muted-foreground">→ {route.transfers[i - 1]} 환승 →</span> : null}
              <span className="inline-flex items-center gap-1 font-semibold text-ink">
                <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: lineColor(line) }} />
                {line}
              </span>
            </Fragment>
          ))}
        </span>
      </p>
      {person.directionsUrl ? (
        <a
          href={person.directionsUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => track("map_app_opened", { app: "kakao", rank: rank ?? 0 })}
          aria-label={`${person.shortName} 카카오맵 길찾기`}
          className="inline-flex min-h-11 shrink-0 items-center gap-1 text-[13px] font-semibold text-ink underline underline-offset-2"
        >
          <RouteIcon className="size-3.5" aria-hidden="true" />
          카카오맵 길찾기
        </a>
      ) : null}
    </div>
  );
}

/** 트랙 아래 눈금 숫자. 트랙과 같은 가로 범위에 그린다. */
function Axis({ end, step }: { end: number; step: number }) {
  const values: number[] = [];
  for (let value = 0; value <= end; value += step) values.push(value);
  return (
    <div aria-hidden="true" className="tabular relative h-4 text-[11px] leading-4 text-muted-foreground">
      {values.map((value) => (
        <span
          key={value}
          className={value === 0 ? "absolute left-0" : value === end ? "absolute right-0" : "absolute -translate-x-1/2"}
          style={value === 0 || value === end ? undefined : { left: percent(value, end) }}
        >
          {value === end ? `${value}분` : value}
        </span>
      ))}
    </div>
  );
}

/**
 * 사람별 시간. 한 사람이 두 줄이다(경로가 있으면 세 줄): 위 줄은 이름·환승·분, 아래 줄은 트랙, 그 아래는 경로 글과 길찾기. 트랙은 모든 사람이 카드 폭 전체로 시작·끝·길이가 같고,
 * 맨 아래 눈금(0·10·20…분)이 기준이다(이름 길이와 무관, V1). 이름은 서버 짧은 이름(shortLabel). 숫자는 표시 분 규칙(30초 올림)을 따른다.
 */
export function TimeRails({
  people,
  maxMinutes,
  meIndex = null,
  size = "large",
  routesOnly = false,
  rank,
}: {
  people: readonly PersonTimeView[];
  maxMinutes: number;
  meIndex?: number | null;
  routesOnly?: boolean;
  size?: "large" | "compact";
  /** 몇 위 카드의 막대인가(길찾기 이벤트의 `rank`). */
  rank?: number;
}) {
  const ordered =
    meIndex === null ? people : [...people].sort((a, b) => Number(b.index === meIndex) - Number(a.index === meIndex));
  const { end, step } = railScale(maxMinutes);
  return (
    <div className="flex flex-col gap-2.5">
      <ul className="flex flex-col gap-3.5">
        {ordered
          .filter((person) => !routesOnly || person.route)
          .map((person) => {
            const note = originNote(person);
            return (
              <li key={person.index} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
                    <span className="text-[15px] font-bold break-all text-ink">
                      {person.shortName}
                      {person.index === meIndex ? (
                        <span className="ml-1 text-xs font-semibold text-muted-foreground">(나)</span>
                      ) : null}
                    </span>
                    <span className="text-[13px] text-muted-foreground">
                      {[note, shownTransferLabel(person)].filter(Boolean).join(" · ")}
                    </span>
                  </p>
                  {!routesOnly && (
                    <span
                      className={
                        size === "large"
                          ? "tabular shrink-0 text-[22px] leading-none font-extrabold tracking-tight text-ink"
                          : "tabular shrink-0 text-[17px] leading-none font-bold text-ink"
                      }
                    >
                      {formatMinutes(person.minutes)}
                    </span>
                  )}
                </div>
                {routesOnly && person.route ? (
                  <span aria-hidden="true" className="relative block h-3.5" data-route="lines">
                    {/* 요약 막대와 같은 축이라 길이가 곧 시간이다(꽉 찬 막대가 모두 같은 시간으로 읽히지 않게). */}
                    <RouteFill route={person.route} width={`${(person.minutes / Math.max(1, maxMinutes)) * 100}%`} />
                  </span>
                ) : (
                  <Track person={person} end={end} step={step} />
                )}
                <RouteLine person={person} rank={rank} />
              </li>
            );
          })}
      </ul>
      {!routesOnly && <Axis end={end} step={step} />}
      {ordered.some((person) => person.route) ? (
        <p className="text-[12px] leading-snug break-keep text-muted-foreground">
          막대 색은 타는 노선, 회색은 기다리거나 갈아타는 시간이에요. 열차 시각은 카카오맵 길찾기에서 확인해요.
        </p>
      ) : null}
    </div>
  );
}
