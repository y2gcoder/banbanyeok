import { describe, expect, it } from "vitest";
import fixture from "../../../fixtures/seo-pairs.json";
import { dataVersionDate, parseSeoPairs } from "./pairs";

const result = {
  stationCode: "ct5",
  times: [990, 900],
  transfers: [0, 1],
  maxSeconds: 990,
  spreadSeconds: 90,
  totalSeconds: 1890,
  reason: "가장 오래 걸리는 강남도 17분이에요.",
};
const file = (pairs: unknown[], extra: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  dataVersion: "20261112.6",
  pairs,
  ...extra,
});
const pair = (patch: Record<string, unknown> = {}) => ({ a: "1qs", b: "dxy", results: [result], ...patch });

describe("seo-pairs.json 검증", () => {
  it("개발용 표본은 형식을 지킨다", () => {
    const parsed = parseSeoPairs(fixture);
    expect(parsed.dataVersion).toMatch(/^[0-9]{8}\.[0-9]+$/);
    expect(parsed.pairs.length).toBeGreaterThan(3);
  });

  it("텍스트와 파싱된 값 둘 다 받는다", () => {
    expect(parseSeoPairs(JSON.stringify(file([pair()]))).pairs).toHaveLength(1);
  });

  it("a<b(코드 사전순)가 아니면 거부한다 — 웹은 순서를 몰래 고치지 않는다", () => {
    expect(() => parseSeoPairs(file([pair({ a: "dxy", b: "1qs" })]))).toThrow("a<b");
    expect(() => parseSeoPairs(file([pair({ a: "1qs", b: "1qs" })]))).toThrow("a<b");
  });

  it("같은 쌍이 두 번이면 거부한다", () => {
    expect(() => parseSeoPairs(file([pair(), pair()]))).toThrow("중복된 쌍");
  });

  it("한 쌍의 결과는 1~3개, 같은 역은 한 번만", () => {
    expect(() => parseSeoPairs(file([pair({ results: [] })]))).toThrow();
    expect(() => parseSeoPairs(file([pair({ results: Array(4).fill(result) })]))).toThrow();
    expect(() => parseSeoPairs(file([pair({ results: [result, result] })]))).toThrow("같은 역");
  });

  it("최장·차이·합계는 times에서 계산한 값과 같아야 한다", () => {
    const bad = { ...result, maxSeconds: 991 };
    expect(() => parseSeoPairs(file([pair({ results: [bad] })]))).toThrow("maxSeconds");
  });

  it("알 수 없는 키, 잘못된 역 코드, 잘못된 버전은 거부한다", () => {
    expect(() => parseSeoPairs(file([pair({ extra: 1 })]))).toThrow();
    expect(() => parseSeoPairs(file([pair({ a: "ABC" })]))).toThrow("역 코드 형식");
    expect(() => parseSeoPairs(file([pair({ a: "1ql" })]))).toThrow("역 코드 형식"); // l은 알파벳에 없다
    expect(() => parseSeoPairs(file([], { schemaVersion: 2 }))).toThrow();
    expect(() => parseSeoPairs(file([], { dataVersion: "2026-11-12" }))).toThrow("YYYYMMDD.N");
    expect(() => parseSeoPairs(file([], { extra: true }))).toThrow();
  });

  it("오류 메시지는 어디가 문제인지 알려 준다", () => {
    expect(() => parseSeoPairs(file([pair({ a: "dxy", b: "1qs" })]))).toThrow(/pairs\.0\.a/);
  });
});

describe("dataVersion의 날짜", () => {
  it("YYYYMMDD.N에서 날짜를 읽는다", () => {
    expect(dataVersionDate("20261112.6")).toEqual({ year: 2026, month: 11, day: 12, iso: "2026-11-12" });
  });

  it("형식이 아니면 오류", () => {
    expect(() => dataVersionDate("1.0")).toThrow(RangeError);
  });
});
