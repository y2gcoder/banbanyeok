import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type LineSourceStation, stationLineLabels } from "../../../scripts/station-lines.ts";
import { stationByCode } from ".";

const station = (lines: string[], sources: Record<string, string> = {}) => ({
  code: "zzz",
  name: "시험",
  lines,
  sources,
});

describe("법정 노선명 → 표시 노선명", () => {
  it("경원선은 그 역의 TAGO 운행 노선으로 푼다(#130)", () => {
    expect(stationLineLabels(station(["경원선"], { "tago:1호선": "x" }))).toEqual(["1호선"]);
    expect(stationLineLabels(station(["경원선"], { "tago:경의중앙": "x" }))).toEqual(["경의중앙선"]);
    expect(stationLineLabels(station(["경원선", "분당선"], { "tago:경의중앙": "x", "tago:수인분당": "y" }))).toEqual([
      "경의중앙선",
      "수인분당선",
      "수인분당선",
    ]);
  });

  it("경원선인데 아는 TAGO 운행 노선이 없으면 1호선으로 짐작하지 않고 멈춘다", () => {
    expect(() => stationLineLabels(station(["경원선"]))).toThrow(/경원선 역 시험\(zzz\)/);
    expect(() => stationLineLabels(station(["경원선"], { "tago:의정부": "x" }))).toThrow(/TAGO 운행 노선/);
  });

  it("다른 법정 노선명은 TAGO와 무관하게 고정 매핑이고, 모르는 이름은 그대로 쓰며 모은다", () => {
    const unknown = new Set<string>();
    expect(stationLineLabels(station(["경부선", "일산선", "새노선"], { "tago:경의중앙": "x" }), unknown)).toEqual([
      "1호선",
      "3호선",
      "새노선",
    ]);
    expect([...unknown]).toEqual(["새노선"]);
  });

  it("생성된 색인: 경원선 구간 역의 배지", () => {
    const lines = (code: string) => stationByCode(code)?.lines;
    expect(lines("tds")).toEqual(["1호선", "경의중앙선"]); // 용산
    expect(lines("xnc")).toEqual(["4호선", "경의중앙선"]); // 이촌
    expect(lines("847")).toEqual(["경의중앙선"]); // 서빙고
    expect(lines("9cw")).toEqual(["경의중앙선"]); // 한남
    expect(lines("2h7")).toEqual(["3호선", "경의중앙선"]); // 옥수
    expect(lines("60d")).toEqual(["경의중앙선"]); // 응봉
    expect(lines("ct5")).toEqual(["2호선", "5호선", "경의중앙선", "수인분당선"]); // 왕십리
    expect(lines("mj0")).toEqual(["1호선", "경춘선", "경의중앙선", "수인분당선"]); // 청량리
    expect(lines("dyp")).toEqual(["1호선", "경춘선", "경의중앙선"]); // 회기
    expect(lines("cex")).toEqual(["1호선"]); // 외대앞
    expect(lines("68d")).toEqual(["1호선"]); // 소요산
  });

  it.each([
    ["1y8", "광운대", ["1호선", "경춘선"]],
    ["y72", "중랑", ["경춘선", "경의중앙선"]],
    ["73b", "임진강", ["경의중앙선"]],
    ["7sf", "운천", ["경의중앙선"]],
    ["mj0", "청량리", ["1호선", "경춘선", "경의중앙선", "수인분당선"]],
    ["dyp", "회기", ["1호선", "경춘선", "경의중앙선"]],
  ] as const)("정기 운행 배지: %s %s", (code, name, expected) => {
    const registry = JSON.parse(
      readFileSync(new URL("../../../../data/artifacts/dev/stations.json", import.meta.url), "utf8"),
    ) as { stations: LineSourceStation[] };
    const source = registry.stations.find((s) => s.code === code);
    expect(source?.name).toBe(name);
    if (!source) throw new Error(`역 없음: ${code}`);
    expect([...new Set(stationLineLabels(source))].sort()).toEqual([...expected].sort());
    expect(stationByCode(code)?.lines).toEqual(expected);
  });
});
