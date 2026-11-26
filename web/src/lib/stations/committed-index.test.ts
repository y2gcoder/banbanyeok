import { describe, expect, it } from "vitest";
import capital from "./capital.fixture.gen.json";
import committed from "./index.gen.json";

type Index = { lines: string[]; stations: unknown[][]; regions?: unknown };

/** 역 한 줄을 노선 번호 대신 노선 이름으로(두 색인의 노선 표가 다르다). */
function byCode(index: Index): Map<string, unknown[]> {
  return new Map(
    index.stations.map((row) => {
      const [code, name, lines, ...rest] = row as [string, string, number[], ...unknown[]];
      return [code, [name, lines.map((i) => index.lines[i]), ...rest]];
    }),
  );
}

describe("커밋된 역 색인", () => {
  it("부산권을 켜도 수도권 역은 권역을 켜기 전 색인과 한 글자도 다르지 않다", () => {
    const before = byCode(capital as Index);
    const now = byCode(committed as Index);
    if (!(committed as Index).regions) {
      expect(committed).toEqual(capital);
      return;
    }
    for (const [code, row] of before) expect(now.get(code), code).toEqual(row);
    expect((committed as { dataVersion: string }).dataVersion).toBe((capital as { dataVersion: string }).dataVersion);
  });
});
