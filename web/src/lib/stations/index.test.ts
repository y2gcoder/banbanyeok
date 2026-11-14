import { describe, expect, it } from "vitest";
import { searchStations, stationByCode } from ".";

const names = (query: string) => searchStations(query).map((s) => s.name);

describe("역 검색", () => {
  it("이름 생략형과 역 접미사", () => {
    expect(names("홍대")[0]).toBe("홍대입구");
    expect(names("강남역")[0]).toBe("강남");
    expect(names(" 강 남 ")[0]).toBe("강남");
  });

  it("초성과 조합 중인 글자", () => {
    expect(names("ㅎㄷㅇㄱ")).toContain("홍대입구");
    expect(names("홍ㄷ")[0]).toBe("홍대입구");
  });

  it("한/영 전환을 잊고 친 입력", () => {
    expect(names("ghdeo")[0]).toBe("홍대입구");
  });

  it("수도권 밖 역은 보이되 계산할 수 없다고 표시한다", () => {
    const busan = searchStations("서면").find((s) => s.lines.some((l) => l.startsWith("부산")));
    expect(busan?.supported).toBe(false);
    expect(searchStations("강남")[0]?.supported).toBe(true);
  });

  it("없는 역과 빈 입력", () => {
    expect(searchStations("")).toEqual([]);
    expect(searchStations("없는역이름입니다")).toEqual([]);
  });

  it("코드로 찾으면 노선 표시명과 좌표가 있다", () => {
    const gangnam = searchStations("강남")[0];
    expect(gangnam && stationByCode(gangnam.code)?.lines).toContain("2호선");
    expect(gangnam?.geo).not.toBeNull();
  });

  it("폐기된 코드는 replacedBy의 정식 역으로 찾는다(옛 링크)", () => {
    expect(stationByCode("194")?.code).toBe("nn9"); // 공덕
    expect(stationByCode("ve5")?.name).toBe("홍대입구");
    expect(stationByCode("zz0")).toBeUndefined();
  });
});
