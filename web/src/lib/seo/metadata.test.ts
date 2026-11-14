import type { Metadata } from "next";
import { describe, expect, it } from "vitest";
import fixture from "../../../fixtures/seo-pairs.json";
import { hubMetadata, pairDescription, pairMetadata, pairTitle, sharedLinkMetadata, siteMetadata } from "./metadata";
import { buildPairPages, type PairPage } from "./pair-pages";
import { parseSeoPairs } from "./pairs";

const env = { SITE_URL: "https://banban.example" };
const page = buildPairPages(parseSeoPairs(fixture)).pages.find(
  (p) => p.first.name === "강남" && p.second.name === "홍대입구",
) as PairPage;

const og = (meta: Metadata) => meta.openGraph as Record<string, unknown>;
const tw = (meta: Metadata) => meta.twitter as Record<string, unknown>;

describe("조합 페이지 메타데이터", () => {
  const meta = pairMetadata(page, env);

  it("제목: 역 이름 두 개와 후보 수", () => {
    expect(pairTitle(page)).toBe("강남역·홍대입구역 중간 만날 곳 추천 3곳");
    expect(meta.title).toBe(pairTitle(page));
  });

  it("설명: 1위와 각자 시간을 앞에 두고 짧다", () => {
    const text = pairDescription(page);
    expect(text).toBe(
      "강남과 홍대입구에서 출발하면 신림은 가장 공평해요. 강남 16분, 홍대입구 19분. 후보 3곳의 시간·환승·이유를 비교해 보세요.",
    );
    expect(Array.from(text).length).toBeLessThanOrEqual(100);
    expect(meta.description).toBe(text);
  });

  it("canonical은 절대 주소이고 반대 순서(B-A)가 아니라 정규 주소다", () => {
    expect(meta.alternates?.canonical).toBe(`https://banban.example${page.path}`);
    expect(page.path).toMatch(/^\/meet\/[0-9a-z]{3}-[0-9a-z]{3}$/);
  });

  it("Open Graph와 Twitter 카드를 빠짐없이 채운다(이미지는 opengraph-image 파일 규약이 붙인다)", () => {
    expect(og(meta)).toMatchObject({
      type: "website",
      siteName: "반반역",
      locale: "ko_KR",
      url: `https://banban.example${page.path}`,
      title: "강남역·홍대입구역 중간 만날 곳 추천 3곳 | 반반역",
      description: meta.description,
    });
    expect(tw(meta)).toMatchObject({
      card: "summary_large_image",
      title: og(meta).title,
      description: meta.description,
    });
  });

  it("색인: SITE_URL이 localhost가 아닐 때만 허용, 아니면 noindex", () => {
    expect(meta.robots).toBeUndefined();
    expect(pairMetadata(page, {}).robots).toEqual({ index: false, follow: false });
    expect(pairMetadata(page, { SITE_URL: "http://localhost:3000" }).robots).toEqual({ index: false, follow: false });
  });

  it("SITE_URL이 없으면 localhost 주소(하드코딩된 도메인 없음)", () => {
    expect(pairMetadata(page, {}).alternates?.canonical).toBe(`http://localhost:3000${page.path}`);
  });
});

describe("허브·사이트 기본 메타데이터", () => {
  it("허브", () => {
    const meta = hubMetadata(env);
    expect(meta.title).toBe("인기 역 조합별 만날 곳 추천");
    expect(meta.alternates?.canonical).toBe("https://banban.example/meet");
    expect(og(meta).url).toBe("https://banban.example/meet");
    expect(hubMetadata({}).robots).toEqual({ index: false, follow: false });
  });

  it("사이트 기본: metadataBase, title 템플릿, 설명, OG·Twitter", () => {
    const meta = siteMetadata(env);
    expect(String(meta.metadataBase)).toBe("https://banban.example/");
    expect(meta.title).toEqual({ default: "반반역", template: "%s | 반반역" });
    expect(meta.description).toContain("공평하게 만날 역");
    expect(og(meta)).toMatchObject({ siteName: "반반역", locale: "ko_KR", url: "https://banban.example/" });
    expect(tw(meta)).toMatchObject({ card: "summary_large_image" });
    expect(meta.robots).toBeUndefined();
    expect(siteMetadata({}).robots).toEqual({ index: false, follow: false });
  });
});

describe("공유 링크 메타데이터", () => {
  it("색인하지 않고, 링크별 제목·설명·이미지를 쓴다", () => {
    const meta = sharedLinkMetadata({
      title: "신촌에서 볼까?",
      description: "나 34분 · 지훈 38분 · 공평하게 고름",
      imagePath: "/s/og?v=1&o=a1b.c2d&m=f&dv=20261112.6",
    });
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.title).toBe("신촌에서 볼까?");
    expect(og(meta)).toMatchObject({
      title: "신촌에서 볼까? | 반반역",
      description: "나 34분 · 지훈 38분 · 공평하게 고름",
      images: [{ url: "/s/og?v=1&o=a1b.c2d&m=f&dv=20261112.6", width: 1200, height: 630 }],
    });
    expect(tw(meta)).toMatchObject({
      card: "summary_large_image",
      images: [{ url: expect.stringContaining("/s/og") }],
    });
  });

  it("결과를 못 가져왔으면 기본 제목으로(이미지는 사이트 기본 미리보기가 맡는다)", () => {
    const meta = sharedLinkMetadata(null);
    expect(meta.title).toBe("만날 역 후보");
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.openGraph).toBeUndefined();
  });
});
