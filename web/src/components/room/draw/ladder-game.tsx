"use client";

import { useEffect, useMemo, useState } from "react";
import { personColor } from "@/components/common/person-color";
import type { DrawPerson } from "@/lib/room/draw";
import { cn } from "@/lib/utils";
import { ladderOf, ladderPath } from "./draw-layout";

export type DrawPhase = "idle" | "playing" | "done";

const W = 320;
const H = 250;
/** 모든 길이 함께 내려와 같은 때 바닥에 닿는다. */
export const LADDER_PLAY_MS = 3200;

type Props = {
  people: readonly DrawPerson[];
  /** people 안의 당첨자 위치. 뽑기 전이면 null. */
  winner: number | null;
  seed: number;
  phase: DrawPhase;
};

/** 사람 색. 뽑은 뒤 나간 사람의 칸은 흐린 선이다. */
const colorOf = (person: DrawPerson) =>
  person.personIndex === null ? "var(--rule-strong)" : personColor(person.personIndex);

/**
 * 사다리타기. 위 칸이 뽑기 대상(입장 순서), 아래 한 칸이 '이쪽으로'. 가로줄은 씨앗에서 나오고 당첨 칸은 당첨자의 길이 닿는 곳이다.
 * 재생이 언제 끝나는지는 감싼 카드가 정한다(이 그림이 없어도 끝나게). 스크린리더에는 카드의 결과 문장이 읽히고, role="img"의 이름은
 * 그림이 끝난 뒤에만 당첨자를 말한다(재생 중에 미리 읽히지 않게).
 */
export function LadderGame({ people, winner, seed, phase }: Props) {
  const ladder = useMemo(() => ladderOf(people.length, seed), [people.length, seed]);
  const goal = winner === null ? null : (ladder.ends[winner] ?? null);
  // 가로줄마다 (행, 왼쪽 줄)이 하나뿐이라 그것으로 이름을 붙인다.
  const rungs = useMemo(
    () => ladder.rungs.flatMap((line, row) => line.map((c) => ({ id: `r${row + 1}c${c}`, c, y: row + 1 }))),
    [ladder],
  );
  const colX = (c: number) => ((c + 0.5) * W) / people.length;
  const rowY = (y: number) => 8 + (y * (H - 16)) / (ladder.rows + 1);
  const [drawn, setDrawn] = useState(phase === "done");

  useEffect(() => {
    if (phase !== "playing") {
      setDrawn(phase === "done");
      return;
    }
    setDrawn(false);
    // 다음 프레임에 길이를 0→1로 바꿔 선이 그려지게 한다.
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => setDrawn(true)));
    return () => cancelAnimationFrame(frame);
  }, [phase]);

  const label =
    winner === null || phase !== "done"
      ? `사다리타기: ${people.map((p) => p.name).join(", ")} 중 한 사람`
      : `사다리타기 결과: ${people[winner]?.name} 쪽으로`;

  return (
    <div className="flex flex-col gap-1.5">
      <ol className="grid" style={{ gridTemplateColumns: `repeat(${people.length}, minmax(0, 1fr))` }}>
        {people.map((person, index) => (
          <li key={person.id} className="flex min-w-0 justify-center px-0.5">
            <span
              className={cn(
                "inline-flex max-w-full items-center gap-1 rounded-full border border-rule bg-surface px-2 py-1 text-[14px] font-bold text-ink",
                person.left && "border-dashed font-semibold text-ink-soft",
                // 끝나면 당첨자 이름에 테두리를 두른다(나머지를 흐리게 하면 글자 대비가 모자란다).
                phase === "done" && winner !== null && index === winner && "border-ink ring-2 ring-ink",
              )}
            >
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: colorOf(person) }}
              />
              <span className="truncate">{person.name}</span>
            </span>
          </li>
        ))}
      </ol>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="h-auto w-full">
        {people.map((person, c) => (
          <line
            key={person.id}
            x1={colX(c)}
            x2={colX(c)}
            y1={rowY(0)}
            y2={rowY(ladder.rows + 1)}
            stroke="var(--rule-strong)"
            strokeWidth={3}
            strokeLinecap="round"
          />
        ))}
        {phase === "idle"
          ? null
          : rungs.map((rung) => (
              <line
                key={rung.id}
                x1={colX(rung.c)}
                x2={colX(rung.c + 1)}
                y1={rowY(rung.y)}
                y2={rowY(rung.y)}
                stroke="var(--rule-strong)"
                strokeWidth={3}
                strokeLinecap="round"
              />
            ))}
        {phase === "idle"
          ? null
          : people.map((person, start) => {
              const points = ladderPath(ladder, start)
                .map((p) => `${colX(p.x)},${rowY(p.y)}`)
                .join(" ");
              const isWinner = start === winner;
              return (
                <polyline
                  key={person.id}
                  points={points}
                  fill="none"
                  stroke={colorOf(person)}
                  strokeWidth={isWinner ? 6 : 4}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  pathLength={1}
                  strokeDasharray="1 1"
                  strokeDashoffset={drawn ? 0 : 1}
                  opacity={phase === "done" && !isWinner ? 0.35 : 0.95}
                  style={{
                    transition:
                      phase === "playing"
                        ? `stroke-dashoffset ${LADDER_PLAY_MS}ms cubic-bezier(.45,.05,.55,.95)`
                        : "none",
                  }}
                />
              );
            })}
        {phase === "idle" ? (
          <g>
            <rect
              x={W / 2 - 34}
              y={H / 2 - 30}
              width={68}
              height={60}
              rx={14}
              fill="var(--surface)"
              stroke="var(--rule)"
            />
            <text x={W / 2} y={H / 2 + 13} textAnchor="middle" fontSize={38} fontWeight={800} fill="var(--ink-soft)">
              ?
            </text>
          </g>
        ) : null}
      </svg>
      <ol
        aria-hidden="true"
        className="grid"
        style={{ gridTemplateColumns: `repeat(${people.length}, minmax(0, 1fr))` }}
      >
        {people.map((person, slot) => {
          const isGoal = slot === goal;
          const reached = isGoal && phase === "done";
          return (
            <li key={person.id} className="flex justify-center px-0.5">
              <span
                className={cn(
                  "rounded-md px-1.5 py-1 font-extrabold whitespace-nowrap",
                  people.length >= 4 ? "text-[12px]" : "text-[13px]",
                  phase === "idle" ? "text-muted-foreground" : isGoal ? "text-safety-ink" : "text-muted-foreground",
                  isGoal && phase !== "idle" && "bg-safety",
                  reached && "ring-2 ring-ink",
                )}
              >
                {phase === "idle" ? "?" : isGoal ? "★ 이쪽으로" : "–"}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
