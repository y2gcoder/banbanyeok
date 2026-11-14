import { describe, expect, it } from "vitest";
import fixture from "../../../fixtures/seo-pairs.json";
import stationIndex from "../stations/index.gen.json";
import { stationByCode } from "../stations/index.ts";
import {
  buildPairPages,
  findPairPage,
  groupByStation,
  MEANINGFUL,
  type PairPage,
  pairSlug,
  relatedPages,
  skipReason,
} from "./pair-pages";
import { parseSeoPairs, type SeoPair, type SeoPairsFile } from "./pairs";

const code = (name: string): string => {
  const found = fixture.pairs
    .flatMap((p) => [p.a, p.b, ...p.results.map((r) => r.stationCode)])
    .find((c) => stationByCode(c)?.name === name);
  if (!found) throw new Error(`표본에 없는 역: ${name}`);
  return found;
};

const result = (stationCode: string, a: number, b: number) => ({
  stationCode,
  times: [a, b] as [number, number],
  transfers: [0, 0] as [number, number],
  maxSeconds: Math.max(a, b),
  spreadSeconds: Math.abs(a - b),
  totalSeconds: a + b,
  reason: "이유",
});

const fileOf = (pairs: SeoPair[]): SeoPairsFile => ({ schemaVersion: 1, dataVersion: "20261112.6", pairs });
const gangnam = code("강남");
const hongdae = code("홍대입구");
const sinchon = code("신촌");

describe("조합 주소(코드 사전순으로 한 가지, 반대 순서는 만들지 않는다)", () => {
  it("A-B와 B-A는 같은 주소 조각이다", () => {
    expect(pairSlug("dxy", "1qs")).toBe("1qs-dxy");
    expect(pairSlug("1qs", "dxy")).toBe("1qs-dxy");
  });

  it("표본의 모든 페이지는 정규 주소 /meet/<a>-<b>를 갖는다", () => {
    const { pages } = buildPairPages(parseSeoPairs(fixture));
    expect(pages.length).toBe(fixture.pairs.length);
    for (const page of pages) expect(page.path).toBe(`/meet/${page.slug}`);
    expect(pages.map((p) => p.slug)).toEqual(fixture.pairs.map((p) => `${p.a}-${p.b}`).sort());
  });

  it("주소는 ASCII다(OpenNext/Workers에서 비ASCII 경로 SSG가 404였다)", () => {
    const { pages } = buildPairPages(parseSeoPairs(fixture));
    for (const page of pages) expect(page.slug).toMatch(/^[0-9a-z]{3}-[0-9a-z]{3}$/);
  });

  it("slug로 페이지를 찾는다", () => {
    const { pages } = buildPairPages(parseSeoPairs(fixture));
    const page = pages[0] as PairPage;
    expect(findPairPage(pages, page.slug)).toBe(page);
    expect(findPairPage(pages, "zzz-zzz")).toBeUndefined();
  });
});

describe("페이지 모델", () => {
  it("보이는 순서는 가나다 순이고, 시간은 그 순서에 맞게 따라 바뀐다", () => {
    const [x, y] = [gangnam, hongdae].sort() as [string, string];
    const timesOfX = 600;
    const timesOfY = 900;
    const { pages } = buildPairPages(
      fileOf([{ a: x, b: y, results: [result(sinchon, timesOfX, timesOfY), result(code("잠실"), 700, 800)] }]),
    );
    const page = pages[0] as PairPage;
    expect([page.first.name, page.second.name]).toEqual(["강남", "홍대입구"]);
    const top = page.candidates[0];
    const minutesByName = Object.fromEntries((top?.people ?? []).map((p) => [p.stationName, p.minutes]));
    expect(minutesByName[stationByCode(x)?.name ?? ""]).toBe(10);
    expect(minutesByName[stationByCode(y)?.name ?? ""]).toBe(15);
    expect(top?.people.map((p) => p.stationName)).toEqual(["강남", "홍대입구"]); // 표시 순서
    expect(top?.aggregate).toMatchObject({ max: 15, spread: 5, total: 25 });
    expect(top?.station.label).toBe("신촌역");
  });

  it("순위는 파일 순서 그대로다(웹은 다시 계산하지 않는다)", () => {
    const { pages } = buildPairPages(parseSeoPairs(fixture));
    for (const page of pages)
      expect(page.candidates.map((c) => c.rank)).toEqual([1, 2, 3].slice(0, page.candidates.length));
  });

  it("알 수 없는 역 코드는 오류(데이터와 역 인덱스가 어긋남)", () => {
    expect(() =>
      buildPairPages(fileOf([{ a: "000", b: "001", results: [result(sinchon, 600, 700), result(gangnam, 700, 800)] }])),
    ).toThrow("역 인덱스에 없는 코드");
  });
});

describe("의미 있는 쌍만(얇은 페이지 방지)", () => {
  const [a, b] = [gangnam, hongdae].sort() as [string, string];
  const pairOf = (...results: SeoPair["results"]): SeoPair => ({ a, b, results });
  const other = result(code("잠실"), 700, 800);

  it("후보가 하나뿐이면 거른다", () => {
    expect(skipReason(pairOf(result(sinchon, 600, 700)))).toContain("후보가 1개");
  });

  it("1위 최장이 5분 이하(같은 동네)면 거른다", () => {
    expect(skipReason(pairOf(result(sinchon, MEANINGFUL.minTopSeconds, 100), other))).toContain("5분 이하");
    expect(skipReason(pairOf(result(sinchon, MEANINGFUL.minTopSeconds + 1, 100), other))).toBeNull();
  });

  it("1위 최장이 90분을 넘으면 거른다(정확히 90분은 남긴다)", () => {
    expect(skipReason(pairOf(result(sinchon, MEANINGFUL.maxTopSeconds, 100), other))).toBeNull();
    expect(skipReason(pairOf(result(sinchon, MEANINGFUL.maxTopSeconds + 1, 100), other))).toContain("90분 초과");
  });

  it("거른 쌍은 이유와 함께 skipped에 남고 페이지는 만들지 않는다", () => {
    const [c, d] = [sinchon, code("잠실")].sort() as [string, string];
    const { pages, skipped } = buildPairPages(
      fileOf([pairOf(result(sinchon, 600, 700)), { a: c, b: d, results: [result(gangnam, 600, 700), other] }]),
    );
    expect(pages.map((p) => p.slug)).toEqual([`${c}-${d}`]);
    expect(skipped).toEqual([{ a, b, reason: expect.stringContaining("후보가 1개") }]);
  });

  it("이름이 같은 두 역(서로 다른 역인데 이름이 같은 경우)은 조합 페이지를 만들지 않는다", () => {
    const byName = new Map<string, string[]>();
    for (const row of stationIndex.stations) {
      const [stationCode, name] = row as [string, string];
      byName.set(name, [...(byName.get(name) ?? []), stationCode]);
    }
    const twins = [...byName.values()].find((codes) => codes.length >= 2) as string[]; // 신촌(2호선·경의중앙) 등
    const [x, y] = twins.sort() as [string, string];
    const { pages, skipped } = buildPairPages(fileOf([{ a: x, b: y, results: [result(sinchon, 600, 700), other] }]));
    expect(pages).toEqual([]);
    expect(skipped[0]?.reason).toBe("두 역의 이름이 같음");
  });
});

describe("관련 조합(내부 링크)", () => {
  it("같은 역이 들어간 다른 조합을 주소순으로, 자기 자신은 빼고", () => {
    const { pages } = buildPairPages(parseSeoPairs(fixture));
    const page = pages.find((p) => p.first.name === "강남" || p.second.name === "강남") as PairPage;
    const related = relatedPages(pages, page);
    expect(related.length).toBeGreaterThan(0);
    expect(related.map((p) => p.slug)).not.toContain(page.slug);
    for (const item of related) {
      expect([item.first.name, item.second.name].some((n) => [page.first.name, page.second.name].includes(n))).toBe(
        true,
      );
    }
    expect(relatedPages(pages, page, 1)).toHaveLength(1);
  });
});

describe("허브 묶음(역별)", () => {
  it("한 조합은 두 역 아래에 한 번씩, 상대 역 이름순으로", () => {
    const { pages } = buildPairPages(parseSeoPairs(fixture));
    const groups = groupByStation(pages);
    const total = groups.reduce((sum, g) => sum + g.partners.length, 0);
    expect(total).toBe(pages.length * 2);
    const names = groups.map((g) => g.station.name);
    expect(names).toEqual([...names].sort());
    const gangnamGroup = groups.find((g) => g.station.name === "강남");
    const partners = gangnamGroup?.partners.map((p) => p.partner.name) ?? [];
    expect(partners.length).toBeGreaterThan(1);
    expect(partners).toEqual([...partners].sort());
    for (const { page, partner } of gangnamGroup?.partners ?? []) {
      expect([page.first.name, page.second.name]).toContain(partner.name);
      expect([page.first.name, page.second.name]).toContain("강남");
    }
  });

  it("페이지가 없으면 비어 있다", () => {
    expect(groupByStation([])).toEqual([]);
  });
});
