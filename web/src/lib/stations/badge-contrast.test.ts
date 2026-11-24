import { describe, expect, it } from "vitest";
import { LINE_LABELS } from "../../../scripts/station-lines.ts";
import { contrastRatio, smallBadgeTextColor } from "./badge-contrast";
import raw from "./index.gen.json";
import { lineColor, lineTextColor } from "./lines";

const allLines = [...new Set([...Object.values(LINE_LABELS), ...raw.lines, "없는 노선"])];

describe("노선 배지 글자 대비", () => {
  it("화면의 작은 배지 글자는 모든 노선에서 배경과 4.5:1 이상이다(작은 글자 AA)", () => {
    for (const line of allLines) {
      expect(contrastRatio(lineColor(line), smallBadgeTextColor(line)), line).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("이미 4.5:1을 넘는 노선은 미리보기 그림과 같은 글자색이다", () => {
    for (const line of allLines) {
      if (contrastRatio(lineColor(line), lineTextColor(line)) >= 4.5)
        expect(smallBadgeTextColor(line), line).toBe(lineTextColor(line));
    }
  });
});
