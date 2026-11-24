import { describe, expect, it } from "vitest";
import { LINE_LABELS } from "../../../scripts/station-lines.ts";
import raw from "./index.gen.json";
import { isCapitalAreaLine, lineColor } from "./lines";

/**
 * 노선 이름 어휘(#146). 표시 노선명은 세 곳에서 온다: 역 배지(scripts/station-lines.ts), 경로 구간(pipeline RouteGraphStage의
 * 노선 이름 → rg.bin), 색표(lines.ts LINE_COLORS). 이름이 색표 키와 어긋나면 화면에서 오류 없이 중립색이 되므로 여기서 막는다.
 * rg.bin 쪽은 pipeline RouteGraphCommittedDataTest가 같은 색표를 읽어 검사한다.
 */
const NEUTRAL = lineColor("없는 노선");

/** 색표에 없어도 되는 표시 노선명: 계산하지 않는 노선(수도권 밖, 인천공항 자기부상). */
const UNCOLOURED = [
  "인천자기부상",
  "부산1호선",
  "부산2호선",
  "부산3호선",
  "부산4호선",
  "부산김해경전철",
  "동해선",
  "대구1호선",
  "대구2호선",
  "대구3호선",
  "대경선",
  "대전1호선",
  "광주1호선",
];

describe("노선 이름 어휘", () => {
  it("계산할 수 있는 역의 배지 노선은 모두 색표에 있다", () => {
    const missing = new Set<string>();
    for (const [, , lineIdx, , supported] of raw.stations) {
      if (supported !== 1) continue;
      for (const i of lineIdx as number[]) {
        const line = raw.lines[i] ?? "";
        if (!isCapitalAreaLine(line)) missing.add(line);
      }
    }
    expect([...missing]).toEqual([]);
  });

  it("색표에 없는 표시 노선명은 계산하지 않는 노선뿐이다(철자가 어긋난 수도권 노선을 막는다)", () => {
    const uncoloured = [...new Set(Object.values(LINE_LABELS))].filter((line) => !isCapitalAreaLine(line));
    expect(uncoloured.sort()).toEqual([...UNCOLOURED].sort());
    for (const line of uncoloured) expect(lineColor(line)).toBe(NEUTRAL);
  });
});
