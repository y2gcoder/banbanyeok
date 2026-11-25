import { describe, expect, it } from "vitest";
import { ladderOf, ladderPath, seedOf } from "./draw-layout";

const SEEDS = Array.from({ length: 2000 }, (_, i) => seedOf(`room${i}:1:2026-11-25T11:14:00Z`));

describe("사다리 배치(#172)", () => {
  it("씨앗이 같으면 누가 열어도 같은 사다리다", () => {
    for (const columns of [2, 3, 4]) {
      for (const seed of SEEDS.slice(0, 50)) expect(ladderOf(columns, seed)).toEqual(ladderOf(columns, seed));
    }
    expect(seedOf("qt7yvmsht3:1:a")).toBe(seedOf("qt7yvmsht3:1:a"));
    expect(seedOf("qt7yvmsht3:1:a")).not.toBe(seedOf("qt7yvmsht3:2:a"));
  });

  it("가로줄이 모든 이웃 쌍에 고르게 있고 붙은 가로줄이 없으며, 누구도 출발한 칸 바로 아래에 닿지 않는다", () => {
    for (const columns of [2, 3, 4]) {
      for (const seed of SEEDS) {
        const ladder = ladderOf(columns, seed);
        const counts = Array.from(
          { length: columns - 1 },
          (_, c) => ladder.rungs.filter((row) => row.includes(c)).length,
        );
        expect(Math.min(...counts)).toBeGreaterThanOrEqual(2);
        expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(2);
        for (const row of ladder.rungs) for (const c of row) expect(row).not.toContain(c + 1);
        for (const [start, end] of ladder.ends.entries()) expect(end).not.toBe(start);
        // 도착 칸은 한 사람에 하나(순열)라 당첨 칸이 늘 하나다.
        expect([...ladder.ends].sort()).toEqual(Array.from({ length: columns }, (_, c) => c));
      }
    }
  });

  it("길은 위에서 출발해 가로줄을 따라 꺾이고, 도착 칸에서 끝난다", () => {
    const ladder = ladderOf(3, SEEDS[0] ?? 1);
    for (let start = 0; start < 3; start++) {
      const path = ladderPath(ladder, start);
      expect(path[0]).toEqual({ x: start, y: 0 });
      expect(path.at(-1)).toEqual({ x: ladder.ends[start], y: ladder.rows + 1 });
    }
  });
});
