import { describe, expect, it } from "vitest";
import fixture from "../../../fixtures/seo-pairs.json";
import { pairOgImagePath } from "./pair-og-image";
import { buildPairPages, type PairPage } from "./pair-pages";
import { parseSeoPairs } from "./pairs";

const [page, other] = buildPairPages(parseSeoPairs(fixture)).pages as [PairPage, PairPage];

const withCandidate = (
  source: PairPage,
  change: (candidate: PairPage["candidates"][number]) => PairPage["candidates"][number],
) => ({
  ...source,
  candidates: source.candidates.map((candidate, index) => (index === 0 ? change(candidate) : candidate)),
});

describe("역 조합 그림 주소", () => {
  it("조합 경로 아래 opengraph-image에 8자리 버전이 붙는다", () => {
    expect(pairOgImagePath(page)).toMatch(new RegExp(`^${page.path}/opengraph-image\\?v=[0-9a-f]{8}$`));
  });

  it("같은 데이터면 같은 주소이고, 조합마다 다르다", () => {
    expect(pairOgImagePath(page)).toBe(pairOgImagePath(structuredClone(page)));
    expect(pairOgImagePath(page)).not.toBe(pairOgImagePath(other));
  });

  it("그림에 그려지는 데이터(역 이름·후보 이름·순위·시간)가 바뀌면 버전이 바뀐다", () => {
    const base = pairOgImagePath(page);
    const renamed = { ...page, first: { ...page.first, name: `${page.first.name}2` } };
    const stationRenamed = withCandidate(page, (c) => ({
      ...c,
      station: { ...c.station, name: `${c.station.name}2` },
    }));
    const slower = withCandidate(page, (c) => ({
      ...c,
      people: [{ ...c.people[0], minutes: c.people[0].minutes + 1 }, c.people[1]],
    }));
    for (const changed of [renamed, stationRenamed, slower]) expect(pairOgImagePath(changed)).not.toBe(base);
  });

  it("그림에 안 그려지는 값(이유 문장 등)이 바뀌어도 주소는 그대로다(바뀌지 않은 그림의 캐시를 버리지 않는다)", () => {
    const reworded = withCandidate(page, (c) => ({ ...c, reason: `${c.reason} (고침)` }));
    expect(pairOgImagePath(reworded)).toBe(pairOgImagePath(page));
  });
});
