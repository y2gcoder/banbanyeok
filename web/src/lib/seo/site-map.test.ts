import { describe, expect, it } from "vitest";
import fixture from "../../../fixtures/seo-pairs.json";
import { buildPairPages } from "./pair-pages";
import { parseSeoPairs } from "./pairs";
import { robotsRules, sitemapEntries } from "./site-map";

const env = { SITE_URL: "https://banban.example" };
const { pages } = buildPairPages(parseSeoPairs(fixture));
const site = { dataVersion: "20261112.6", pages };

describe("sitemap.xml", () => {
  it("홈, 허브, 모든 조합 페이지(정규 주소만)를 데이터 날짜로", () => {
    const entries = sitemapEntries(site, env);
    expect(entries.map((e) => e.url)).toEqual([
      "https://banban.example/",
      "https://banban.example/meet",
      ...pages.map((p) => `https://banban.example${p.path}`),
    ]);
    for (const entry of entries) expect(entry.lastModified.toISOString()).toBe("2026-11-12T00:00:00.000Z");
  });

  it("공유 링크(/s)와 결과(/result)는 들어 있지 않다", () => {
    const urls = sitemapEntries(site, env).map((e) => e.url);
    expect(urls.some((u) => u.includes("/s?") || u.includes("/result"))).toBe(false);
  });
});

describe("robots.txt", () => {
  it("색인해도 되는 사이트: 전체 허용(API 제외), sitemap 안내. /s는 막지 않는다(미리보기 크롤러가 읽어야 한다)", () => {
    expect(robotsRules(true, env)).toEqual({
      rules: [{ userAgent: "*", allow: "/", disallow: ["/api/"] }],
      sitemap: "https://banban.example/sitemap.xml",
    });
  });

  it("색인하면 안 되는 사이트(SITE_URL 없음·localhost): 전부 막고 sitemap도 안 낸다", () => {
    expect(robotsRules(false, {})).toEqual({ rules: [{ userAgent: "*", disallow: "/" }] });
  });
});
