import { describe, expect, it, vi } from "vitest";
import { groupByRegion } from "./pair-pages";

/** 계약 픽스처(두 권역)의 인덱스: 001·002 수도권, 003·004·005 부산권. */
vi.mock("@/lib/stations/index.gen.json", async () => ({
  default: (await import("@/lib/stations/regional.fixture.gen.json")).default,
}));

const group = (code: string) => ({ station: { code, name: code, label: code, lines: [] }, partners: [] });

describe("허브의 권역별 묶음", () => {
  it("역 묶음을 그 역의 권역 아래로 모으고, 수도권이 먼저다", () => {
    const regions = groupByRegion([group("004"), group("001"), group("003")]);
    expect(regions.map((r) => [r.name, r.groups.map((g) => g.station.code)])).toEqual([
      ["수도권", ["001"]],
      ["부산권", ["004", "003"]],
    ]);
  });

  it("조합이 한 권역에만 있으면 묶음도 하나다(화면은 권역 제목 없이 지금처럼 그린다)", () => {
    expect(groupByRegion([group("001"), group("002")]).map((r) => r.region)).toEqual(["capital"]);
    expect(groupByRegion([])).toEqual([]);
  });
});
