// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildPairPages } from "@/lib/seo/pair-pages";
import { parseSeoPairs } from "@/lib/seo/pairs";
import fixture from "../../../fixtures/seo-pairs.json";
import { DataBasis } from "./data-basis";
import { JsonLd } from "./json-ld";
import { PairCandidateCard } from "./pair-candidate";

const page = buildPairPages(parseSeoPairs(fixture)).pages.find(
  (p) => p.first.name === "강남" && p.second.name === "홍대입구",
);
if (!page) throw new Error("표본에 강남-홍대입구가 없습니다");
const top = page.candidates[0];
if (!top) throw new Error("후보 없음");

describe("조합 후보 카드", () => {
  it("1위: 역·노선, 출발역별 시간·환승, 최장·차이·합계, 이유 문장", () => {
    render(
      <ol>
        <PairCandidateCard candidate={top} />
      </ol>,
    );
    const card = screen.getByRole("article");
    expect(within(card).getByRole("heading", { name: "신림역" })).toBeInTheDocument();
    expect(within(card).getByText("1위")).toBeInTheDocument();
    expect(within(card).getByText("강남")).toBeInTheDocument();
    expect(within(card).getByText("홍대입구")).toBeInTheDocument();
    expect(within(card).getByText("16분")).toBeInTheDocument();
    expect(within(card).getAllByText("19분").length).toBeGreaterThan(0); // 홍대입구 시간, 최장
    expect(within(card).getAllByText("환승 없음").length).toBeGreaterThan(0);
    expect(within(card).getByText("최장")).toBeInTheDocument();
    expect(within(card).getByText("차이")).toBeInTheDocument();
    expect(within(card).getByText("합계")).toBeInTheDocument();
    expect(card).toHaveTextContent(top.reason);
  });

  it("2위 이하는 순위 숫자만", () => {
    const second = page.candidates[1];
    if (!second) throw new Error("2위 없음");
    render(
      <ol>
        <PairCandidateCard candidate={second} />
      </ol>,
    );
    expect(screen.queryByText("1위")).not.toBeInTheDocument();
    expect(screen.getByRole("article")).toHaveTextContent("2");
  });
});

describe("데이터 기준 안내", () => {
  it("날짜·버전·출처·한계를 밝힌다", () => {
    render(<DataBasis dataVersion="20261112.6" isSample={false} />);
    const note = screen.getByRole("contentinfo");
    expect(note).toHaveTextContent("2026년 11월 12일 데이터(버전 20261112.6)");
    expect(note).toHaveTextContent("공식 시간표나 실시간 안내가 아니니");
    expect(note).toHaveTextContent("국가철도공단");
    expect(note).toHaveTextContent("서울교통공사");
    expect(note).toHaveTextContent("공공누리 제1유형");
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("개발용 표본이면 실제 추천이 아니라고 알린다", () => {
    render(<DataBasis dataVersion="20261112.6" isSample />);
    expect(screen.getByRole("note")).toHaveTextContent("개발용 표본");
  });
});

describe("JSON-LD", () => {
  it("스크립트 안에 JSON 문자열을 그대로 넣는다(이스케이프는 jsonLdText가 맡는다)", () => {
    const { container } = render(<JsonLd data={{ "@type": "BreadcrumbList", name: "a<b" }} />);
    const script = container.querySelector('script[type="application/ld+json"]');
    expect(JSON.parse(script?.textContent ?? "")).toEqual({ "@type": "BreadcrumbList", name: "a<b" });
  });
});
