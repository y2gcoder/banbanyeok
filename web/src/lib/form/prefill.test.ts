import { describe, expect, it } from "vitest";
import { searchStations } from "../stations";
import { parsePrefill, prefillHref } from "./prefill";

const code = (name: string) => searchStations(name).find((s) => s.name === name && s.supported)?.code ?? "";
const gangnam = code("강남");
const hongdae = code("홍대입구");

describe("입력 화면 미리 채우기", () => {
  it("주소를 만든다", () => {
    expect(prefillHref(["1qs", "dxy"])).toBe("/?o=1qs.dxy");
  });

  it("쿼리에서 역을 순서대로 읽는다(앞의 ?는 있어도 된다)", () => {
    expect(parsePrefill(`?o=${gangnam}.${hongdae}`).map((s) => s.name)).toEqual(["강남", "홍대입구"]);
    expect(parsePrefill(`o=${gangnam}.${hongdae}`).map((s) => s.name)).toEqual(["강남", "홍대입구"]);
  });

  it("없거나 알 수 없는 코드, 계산할 수 없는 역은 건너뛴다", () => {
    expect(parsePrefill("")).toEqual([]);
    expect(parsePrefill("?x=1")).toEqual([]);
    expect(parsePrefill(`?o=zzz.${gangnam}.ABC`).map((s) => s.name)).toEqual(["강남"]);
    const unsupported = searchStations("홍대입구").find((s) => !s.supported);
    expect(parsePrefill(`?o=${unsupported?.code}.${gangnam}`).map((s) => s.name)).toEqual(["강남"]);
  });

  it("최대 인원(4명)까지만", () => {
    const five = Array(5).fill(gangnam).join(".");
    expect(parsePrefill(`?o=${five}`)).toHaveLength(4);
  });
});
