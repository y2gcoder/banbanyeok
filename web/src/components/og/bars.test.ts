import { describe, expect, it } from "vitest";
import { emWidth, fitName, fitNames } from "./bars";

describe("막대 그림의 이름 맞추기(fitName)", () => {
  it("들어가면 그대로, 크기만 줄여서 들어가면 줄인다", () => {
    expect(fitName("강남", 200, 30, 24)).toEqual({ text: "강남", size: 30 });
    const shrunk = fitName("동대문역사문화공원 2", 260, 30, 24);
    expect(shrunk.text).toBe("동대문역사문화공원 2");
    expect(shrunk.size).toBeLessThan(30);
  });

  it("그래도 넘치면 가운데를 줄이고 서버가 붙인 번호는 남긴다", () => {
    const one = fitName("동대문역사문화공원 1", 160, 30, 24);
    const two = fitName("동대문역사문화공원 2", 160, 30, 24);
    expect(one.text).toMatch(/^동대.*…원 1$/);
    expect(two.text).toMatch(/…원 2$/);
    expect(one.text).not.toBe(two.text);
  });

  it("번호가 없으면 마지막 두 글자를 남긴다(끝만 다른 긴 별명도 구분된다)", () => {
    const a = fitName("우리회사영업팀막내A", 150, 30, 24);
    const b = fitName("우리회사영업팀막내B", 150, 30, 24);
    expect(a.text.endsWith("내A")).toBe(true);
    expect(a.text).not.toBe(b.text);
  });

  it("폭을 맞춘 뒤에 같아진 이름은 처음 갈리는 글자부터 남긴다(앱에 없는 순번을 쓰지 않는다)", () => {
    const names = ["우리회사영업일팀민지", "우리회사영업이팀민지", "참가자 1"];
    const fitted = fitNames(names, () => 120, 30, 24);
    expect(fitNames(names, () => 400, 30, 24).map((f) => f.text)).toEqual(names);
    expect(fitted.map((f) => f.text)).toEqual(["…일팀민지", "…이팀민지", "참가자 1"]);
    expect(fitted.every((f) => emWidth(f.text) * f.size <= 120)).toBe(true);
  });

  it("갈리는 글자 뒤가 길면 그 글자와 끝을 함께 남긴다", () => {
    const names = ["가나다라마일바사아자차카타파하", "가나다라마이바사아자차카타파하"];
    const fitted = fitNames(names, () => 150, 30, 24);
    expect(fitted.map((f) => f.text)).toEqual([
      expect.stringMatching(/^…일.*…파하$/),
      expect.stringMatching(/^…이.*…파하$/),
    ]);
    expect(fitted.every((f) => emWidth(f.text) * f.size <= 150)).toBe(true);
  });

  it("글자가 모두 같으면(글꼴에 없는 글자만 달랐다) 겹친 사람끼리 목록 순서로 번호를 붙인다", () => {
    expect(fitNames(["지훈", "민수", "지훈"], () => 200, 30, 24).map((f) => f.text)).toEqual([
      "지훈 1",
      "민수",
      "지훈 2",
    ]);
    expect(fitNames(["지훈", "지훈 1", "지훈"], () => 200, 30, 24).map((f) => f.text)).toEqual([
      "지훈 1",
      "지훈 1 2",
      "지훈 3",
    ]);
  });

  it("무작위 긴 이름도 폭 안에 들어가고, 다른 이름은 다르게 남는다", () => {
    const syllables = Array.from("가나다라마바사아자차카타파하동대문역사공원");
    let seed = 202;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed;
    };
    for (let i = 0; i < 500; i += 1) {
      const base = Array.from({ length: 6 + (next() % 10) }, () => syllables[next() % syllables.length]).join("");
      const width = 120 + (next() % 240);
      const names = [`${base} 1`, `${base} 2`, `${base}${syllables[next() % syllables.length]}`];
      const fitted = names.map((name) => fitName(name, width, 30, 22));
      for (const f of fitted) expect(emWidth(f.text) * f.size).toBeLessThanOrEqual(width);
      expect(new Set(fitted.map((f) => f.text)).size).toBe(new Set(names).size);
      const cut = 1 + (next() % (base.length - 1));
      const middle = [0, 1, 2].map((k) => `${base.slice(0, cut)}${syllables[k]}${base.slice(cut)}`);
      const split = fitNames(middle, () => width, 30, 22);
      for (const f of split) expect(emWidth(f.text) * f.size).toBeLessThanOrEqual(width);
      expect(new Set(split.map((f) => f.text)).size).toBe(3);
      expect(split.map((f) => f.text).join("")).not.toContain("참가자");
    }
  });
});
