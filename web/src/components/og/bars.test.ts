import { describe, expect, it } from "vitest";
import { emWidth, fitName } from "./bars";

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
    }
  });
});
