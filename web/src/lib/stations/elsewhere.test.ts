import { describe, expect, it, vi } from "vitest";
import { elsewhere, searchInScope } from "./scope";

vi.mock("./index.gen.json", async () => ({ default: (await import("./elsewhere.fixture")).ELSEWHERE_INDEX }));

const capital = { region: "capital", slot: null } as const;

describe("다른 권역에 있는 역 안내", () => {
  it("고른 권역에 부분 일치 후보가 있어도 다른 권역에만 정확히 같은 이름이 있으면 알린다", () => {
    expect(searchInScope("기장", capital).map((c) => c.station.name)).toEqual(["문학경기장", "월드컵경기장"]);
    expect(elsewhere("기장", capital)).toEqual({ region: "busan", name: "기장", alsoHere: false });
    expect(elsewhere("기장역", capital)).toEqual({ region: "busan", name: "기장", alsoHere: false });
  });

  it("한/영 전환을 잊고 친 이름도 후보 검색과 같은 자판 변환으로 정확히 같은지 본다", () => {
    expect(searchInScope("rlwkd", capital).map((c) => c.station.name)).toEqual(["문학경기장", "월드컵경기장"]);
    expect(elsewhere("rlwkd", capital)).toEqual({ region: "busan", name: "기장", alsoHere: false });
    expect(elsewhere("rlwkddur", capital)).toEqual({ region: "busan", name: "기장", alsoHere: false });
    expect(elsewhere("rudrl", capital)).toBeNull();
  });

  it("고른 권역에도 같은 이름이 있으면 '에도'로 구별할 수 있게 알린다", () => {
    expect(elsewhere("시청", capital)).toEqual({ region: "busan", name: "시청", alsoHere: true });
  });

  it("고른 권역에 후보가 있고 다른 권역은 부분 일치뿐이면 알리지 않는다", () => {
    expect(elsewhere("경기", capital)).toBeNull();
    expect(elsewhere("시", capital)).toBeNull();
  });

  it("고른 권역에 후보가 없으면 다른 권역의 부분 일치도 알린다", () => {
    expect(elsewhere("경기", { region: "busan", slot: null })).toEqual({
      region: "capital",
      name: "문학경기장",
      alsoHere: false,
    });
  });
});
