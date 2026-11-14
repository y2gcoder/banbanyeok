import { personColor } from "@/components/common/person-color";
import { formatMinutes, transferLabel } from "@/lib/display/minutes";
import type { PersonTimeView } from "@/lib/result/view-model";

/** 이름 아래 줄. 이름이 이미 "{역}에서 오는 분"이면 같은 말을 되풀이하지 않는다. */
function originLine(person: PersonTimeView): string {
  if (!person.originName) return "출발역 비공개";
  return person.labelKind === "origin" ? "" : `${person.originName}에서`;
}

/**
 * 사람별 시간. 각자의 노선이 만날 역(오른쪽 끝 고리)으로 들어오는 모습이며, 선 길이는 같은 카드의 최장 시간 기준이다.
 * 숫자는 표시 분 규칙(30초 올림)을 따른다.
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
  return (
    <ul className="flex flex-col gap-3.5">
      {ordered.map((person) => {
        const ratio = maxMinutes === 0 ? 1 : Math.max(person.minutes / maxMinutes, 0.06);
        const isMe = person.index === meIndex;
        return (
          <li
            key={person.index}
            className="grid grid-cols-[minmax(3.5rem,auto)_1fr_auto] items-center gap-x-3 gap-y-0.5"
          >
            <span className="truncate text-[15px] font-bold text-ink">
              {person.name}
              {isMe ? <span className="ml-1 text-xs font-semibold text-muted-foreground">(나)</span> : null}
            </span>
            <span aria-hidden="true" className="relative flex h-3 items-center">
              <span className="absolute inset-x-0 h-[3px] rounded-full bg-rule" />
              <span
                className="relative h-[5px] rounded-full"
                style={{ width: `${ratio * 100}%`, backgroundColor: personColor(person.index) }}
              />
              <span
                className="relative -ml-1 size-3 shrink-0 rounded-full border-[3px] bg-surface"
                style={{ borderColor: personColor(person.index) }}
              />
            </span>
            <span
              className={
                size === "large"
                  ? "tabular text-right text-[22px] leading-none font-extrabold tracking-tight text-ink"
                  : "tabular text-right text-[17px] leading-none font-bold text-ink"
              }
            >
              {formatMinutes(person.minutes)}
            </span>
            <span className="col-start-2 col-end-4 flex justify-between text-[13px] text-muted-foreground">
              <span className="truncate">{originLine(person)}</span>
              <span className="shrink-0">{transferLabel(person.transfers)}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
