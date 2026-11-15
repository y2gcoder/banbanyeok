import { describe, expect, it } from "vitest";
import { encodeShareQuery } from "../link/codec";
import { searchStations } from "../stations";
import { parsePrefill, parseRestore, prefillHref, restoreHref } from "./prefill";

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

describe("다시 입력(결과 → 입력 화면) 복원", () => {
  const state = {
    origins: [code("혜화"), gangnam, hongdae],
    mode: "favor" as const,
    favorIndex: 1,
    nicknames: ["민수", null, "지은"],
    timeSlot: "saturday-night" as const,
  };

  it("주소는 결과 링크와 같은 쿼리다", () => {
    expect(restoreHref(state)).toBe(`/?${encodeShareQuery(state)}`);
  });

  it("모든 줄(역·이름)과 구분·모드·배려하던 사람을 되살린다", () => {
    const restored = parseRestore(restoreHref(state).slice(2));
    expect(restored?.rows.map((r) => [r.nickname, r.station?.name, r.favored])).toEqual([
      ["민수", "혜화", false],
      ["", "강남", true],
      ["지은", "홍대입구", false],
    ]);
    expect(restored?.slot).toBe("saturday-night");
    expect(restored?.mode).toBe("favor");
  });

  it("계산할 수 없는 역은 줄 자리만 남기고 비운다(순서가 어긋나지 않는다)", () => {
    const unsupported = searchStations("임진강").find((s) => !s.supported);
    expect(unsupported).toBeDefined();
    const restored = parseRestore(`?v=2&o=${unsupported?.code}.${gangnam}&m=f&t=weekday-day`);
    expect(restored?.rows.map((r) => r.station?.name ?? null)).toEqual([null, "강남"]);
  });

  it("결과 링크 규칙에 맞지 않으면 null(SEO 미리 채우기 `?o=`로 넘어간다)", () => {
    expect(parseRestore("")).toBeNull();
    expect(parseRestore(`?o=${gangnam}.${hongdae}`)).toBeNull();
    expect(parseRestore("?v=2&o=zzz&m=f&t=weekday-day")).toBeNull();
  });
});
