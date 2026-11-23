import { formatMinutes, transferLabel } from "@/lib/display/minutes";
import type { PersonTimeView } from "@/lib/result/view-model";

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

/** 모든 시간 막대와 끝점은 중립색을 써서 역의 호선 배지와 구분한다. */
function Track({ person, end, step }: { person: PersonTimeView; end: number; step: number }) {
  const at = percent(person.minutes, end);
  return (
    <span aria-hidden="true" className="relative block h-3.5">
      <span className="absolute inset-x-0 top-[5.5px] h-[3px] rounded-full bg-rule" />
      <Ticks end={end} step={step} />
      <span className="absolute top-[4.5px] left-0 h-[5px] rounded-full bg-ink-soft" style={{ width: at }} />
      <span
        className="absolute top-px size-3 -translate-x-1/2 rounded-full border-[3px] border-ink-soft bg-surface"
        style={{ left: at }}
      />
    </span>
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
 * 사람별 시간. 한 사람이 두 줄이다: 위 줄은 이름·환승·분, 아래 줄은 트랙. 트랙은 모든 사람이 카드 폭 전체로 시작·끝·길이가 같고,
 * 맨 아래 눈금(0·10·20…분)이 기준이다(이름 길이와 무관, V1). 이름은 서버 짧은 이름(shortLabel). 숫자는 표시 분 규칙(30초 올림)을 따른다.
 */
export function TimeRails({
  people,
  maxMinutes,
  meIndex = null,
  size = "large",
}: {
  people: readonly PersonTimeView[];
  maxMinutes: number;
  meIndex?: number | null;
  size?: "large" | "compact";
}) {
  const ordered =
    meIndex === null ? people : [...people].sort((a, b) => Number(b.index === meIndex) - Number(a.index === meIndex));
  const { end, step } = railScale(maxMinutes);
  return (
    <div className="flex flex-col gap-2.5">
      <ul className="flex flex-col gap-3.5">
        {ordered.map((person) => {
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
                    {note ? `${note} · ` : ""}
                    {transferLabel(person.transfers)}
                  </span>
                </p>
                <span
                  className={
                    size === "large"
                      ? "tabular shrink-0 text-[22px] leading-none font-extrabold tracking-tight text-ink"
                      : "tabular shrink-0 text-[17px] leading-none font-bold text-ink"
                  }
                >
                  {formatMinutes(person.minutes)}
                </span>
              </div>
              <Track person={person} end={end} step={step} />
            </li>
          );
        })}
      </ul>
      <Axis end={end} step={step} />
    </div>
  );
}
