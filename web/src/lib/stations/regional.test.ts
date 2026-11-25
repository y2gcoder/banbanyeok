import { describe, expect, it, vi } from "vitest";
import { regionScope, unsupportedReason } from "./coverage";
import { compareDataVersions, REGIONS, REGIONS_ENABLED, regionsOf, searchStations, stationByCode } from "./index";
import { blockedReason, elsewhere, OPEN_SCOPE, searchInScope } from "./scope";

/** 계약 픽스처(contracts/fixtures/regional, 두 권역)로 만든 인덱스(pnpm gen:stations). 토요일에 동해선 배차가 없어 부산나(005)는 출발할 수 없다. */
vi.mock("./index.gen.json", async () => ({ default: (await import("./regional.fixture.gen.json")).default }));

const named = (name: string, region: string) => {
  const found = searchStations(name, 8).find((s) => s.name === name && s.region === region);
  if (!found) throw new Error(`${name}(${region}) 없음`);
  return found;
};

describe("권역이 둘인 인덱스", () => {
  it("권역 화면이 켜지고 수도권이 먼저다", () => {
    expect(REGIONS).toEqual(["capital", "busan"]);
    expect(REGIONS_ENABLED).toBe(true);
    expect(stationByCode("003")?.region).toBe("busan");
    expect(stationByCode("002")?.region).toBe("capital");
    expect(regionsOf(["004", "001", null, "zzz"])).toEqual(["capital", "busan"]);
  });

  it("검색은 고른 권역 안에서만 하고, 권역을 모르면 같은 이름에만 권역 이름을 붙인다", () => {
    const capital = searchInScope("교대", { region: "capital", slot: null });
    expect(capital.map((c) => [c.station.code, c.tag])).toEqual([["002", null]]);
    const all = searchInScope("교대", OPEN_SCOPE);
    expect(all.map((c) => c.tag).sort()).toEqual(["부산권", "수도권"]);
    expect(searchInScope("부산가", OPEN_SCOPE).map((c) => c.tag)).toEqual([null]);
  });

  it("고른 권역 밖에만 있는 이름은 그 권역과 역 이름을 알린다", () => {
    expect(searchInScope("부산가", { region: "capital", slot: null })).toEqual([]);
    expect(elsewhere("부산가", { region: "capital", slot: null })).toEqual({ region: "busan", name: "부산가" });
    expect(elsewhere("서울가", { region: "busan", slot: null })).toEqual({ region: "capital", name: "서울가" });
    expect(elsewhere("없는역", { region: "busan", slot: null })).toBeNull();
    expect(elsewhere("부산가", OPEN_SCOPE)).toBeNull();
  });

  it("그 구분에 출발할 수 없는 역은 요일과 노선 이름을 짚어 고를 수 없다", () => {
    const busanNa = named("부산나", "busan");
    expect(blockedReason(busanNa, { region: "busan", slot: "saturday-day" })).toBe(
      "토요일 동해선 시간표를 아직 확인하지 못해 고를 수 없어요",
    );
    expect(blockedReason(busanNa, { region: "busan", slot: "weekday-day" })).toBeNull();
    expect(blockedReason(busanNa, { region: "busan", slot: null })).toBeNull();
    // 동해선도 서는 부산가는 부산1호선으로 출발할 수 있다.
    expect(blockedReason(named("부산가", "busan"), { region: "busan", slot: "saturday-day" })).toBeNull();
    const [choice] = searchInScope("부산나", { region: "busan", slot: "saturday-night" });
    expect(choice?.blocked).toBe("토요일 동해선 시간표를 아직 확인하지 못해 고를 수 없어요");
  });

  it("다른 권역의 역은 그 권역 이름을 이유로 고를 수 없다", () => {
    expect(blockedReason(named("부산가", "busan"), { region: "capital", slot: null })).toBe("부산권 역이에요");
  });

  it("계산 범위 한 줄은 권역마다 다르다", () => {
    expect(regionScope("capital").summary).toBe("수도권 전철 1개 노선을 계산해요");
    expect(regionScope("busan")).toEqual({
      lines: ["부산1호선", "동해선"],
      excluded: [],
      summary: "부산권 전철 2개 노선을 계산해요",
    });
    expect(unsupportedReason({ code: "zzz", lines: ["대구1호선"], supported: false })).toBe(
      "아직 수도권·부산권 전철만 계산해요",
    );
  });

  it("dataVersion은 날짜와 회차를 숫자로 견준다", () => {
    expect(compareDataVersions("20261126.10", "20261126.9")).toBeGreaterThan(0);
    expect(compareDataVersions("20261125.9", "20261126.1")).toBeLessThan(0);
    expect(compareDataVersions("20261126.1", "20261126.1")).toBe(0);
  });
});
