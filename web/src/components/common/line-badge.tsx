import { lineColor, lineShortLabel, lineTextColor } from "@/lib/stations/lines";

/** 노선 배지. 숫자 노선은 원 안 숫자, 그 밖은 둥근 사각형 안 이름(노선도 관례). */
function LineBadge({ line }: { line: string }) {
  const short = lineShortLabel(line);
  const round = short.length === 1;
  return (
    <span
      className={
        round
          ? "inline-flex size-5 items-center justify-center rounded-full text-[11px] font-bold "
          : "inline-flex h-5 items-center rounded-full px-1.5 text-[11px] font-bold "
      }
      style={{ backgroundColor: lineColor(line), color: lineTextColor(line) }}
    >
      <span className="sr-only">{line}</span>
      <span aria-hidden="true">{short}</span>
    </span>
  );
}

export function LineBadges({ lines }: { lines: readonly string[] }) {
  if (lines.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {lines.map((line) => (
        <LineBadge key={line} line={line} />
      ))}
    </span>
  );
}
