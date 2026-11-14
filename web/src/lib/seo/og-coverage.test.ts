import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import stationIndex from "../stations/index.gen.json";
import { missingGlyphs, ogSafeName } from "./og-coverage";
import { OG_NAME_MAX, ogFixedChars } from "./og-text";

const web = resolve(import.meta.dirname, "../../..");

describe("OG 글꼴 글자 범위", () => {
  it("고정 문구의 모든 글자가 글꼴에 있다", () => {
    expect(missingGlyphs(ogFixedChars().join(""))).toEqual([]);
  });

  it("역 인덱스의 모든 역 이름이 글꼴에 있다(빈 네모 방지)", () => {
    const names = stationIndex.stations.map((s) => s[1]).join("");
    expect(missingGlyphs(names)).toEqual([]);
  });

  it("파이프라인의 og-glyphs.txt 글자가 글꼴에 있다", () => {
    const text = readFileSync(resolve(web, "../data/artifacts/dev/og-glyphs.txt"), "utf8");
    expect(missingGlyphs(text.replace(/\s/g, ""))).toEqual([]);
  });

  it("숫자·영문 기본 글자와 흔한 한글(KS X 1001)이 있다", () => {
    expect(missingGlyphs("0123456789ABCabc :.,?!()-·")).toEqual([]);
    expect(missingGlyphs("지훈민수서연하윤")).toEqual([]);
  });
});

describe("글꼴에 없는 글자 대체(ogSafeName)", () => {
  it("글꼴에 있는 이름은 그대로", () => {
    expect(ogSafeName("민수", "나")).toBe("민수");
    expect(ogSafeName("Min2", "나")).toBe("Min2");
  });

  it("이모지 같은 글자만 빼고 남는 글자를 쓴다", () => {
    expect(ogSafeName("지훈🎂", "나")).toBe("지훈");
    expect(ogSafeName("🎂지훈🎂", "나")).toBe("지훈");
  });

  it("남는 글자가 없으면 기본 이름으로 바꾼다(빈 네모·빈 칸 금지)", () => {
    expect(ogSafeName("🎂🎉", "친구1")).toBe("친구1");
    expect(ogSafeName("   ", "나")).toBe("나");
    expect(ogSafeName("", "나")).toBe("나");
    expect(ogSafeName("😀", "친구2")).toBe("친구2");
  });

  it("공백은 하나로 줄이고 앞뒤를 자른다", () => {
    expect(ogSafeName("  김  민수 ", "나")).toBe("김 민수");
  });

  it("길면 자르고 말줄임표를 붙인다(코드 포인트 기준)", () => {
    const long = "가나다라마바사아자차";
    const out = ogSafeName(long, "나");
    expect(Array.from(out)).toHaveLength(OG_NAME_MAX + 1);
    expect(out.endsWith("…")).toBe(true);
    expect(out.startsWith("가나다라마바사")).toBe(true);
    expect(ogSafeName("가나다라마바사", "나")).toBe("가나다라마바사"); // 정확히 최대 길이는 그대로
  });

  it("제어 문자와 한자(서브셋에 없는 글자)도 걸러낸다", () => {
    expect(ogSafeName("지훈\u0000​", "나")).toBe("지훈");
    expect(ogSafeName("漢字", "나")).toBe("나");
  });
});
