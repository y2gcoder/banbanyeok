// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RecommendResult } from "@/lib/api/types";
import { toResultView } from "@/lib/result/view-model";
import { searchStations } from "@/lib/stations";
import { OtherCandidateRow, TopCandidateCard } from "./candidate-card";

const code = (name: string) => searchStations(name)[0]?.code ?? "000";

const result: RecommendResult = {
  status: "ok",
  mode: "fair",
  dataVersion: "20261112.6",
  participants: [
    { participantId: "0", hidden: false, originCode: code("강남"), originName: "강남", nickname: null },
    { participantId: "1", hidden: false, originCode: code("홍대입구"), originName: "홍대입구", nickname: null },
  ],
  candidates: [
    {
      rank: 1,
      stationCode: code("신촌"),
      stationName: "신촌",
      // 2249초 → 37분, 2250초 → 38분: 차이는 반올림한 분에서 1분이어야 한다.
      times: [
        { participantId: "0", seconds: 2249, transfers: 1 },
        { participantId: "1", seconds: 2250, transfers: 0 },
      ],
      maxSeconds: 2250,
      spreadSeconds: 1,
      totalSeconds: 4499,
      reasonCode: "FAIR_MINIMAX",
      reason: "가장 오래 걸리는 지훈도 38분이에요.",
    },
    {
      rank: 2,
      stationCode: code("합정"),
      stationName: "합정",
      times: [
        { participantId: "0", seconds: 2520, transfers: 1 },
        { participantId: "1", seconds: 900, transfers: 0 },
      ],
      maxSeconds: 2520,
      spreadSeconds: 1620,
      totalSeconds: 3420,
      reasonCode: "FAIR_ALTERNATIVE",
      reason: "공평 모드 대안이에요.",
    },
  ],
};

describe("결과 카드", () => {
  const view = toResultView(result, ["민지", "지훈"]);

  it("1위 카드는 사람별 표시 분·환승과 반올림한 분에서 계산한 최장·차이·합계를 보인다", () => {
    const [top] = view.candidates;
    if (!top) throw new Error("후보 없음");
    render(<TopCandidateCard candidate={top} />);
    const card = screen.getByRole("article", { name: "신촌" });
    expect(within(card).getByText("37분")).toBeInTheDocument();
    expect(within(card).getAllByText("38분").length).toBeGreaterThanOrEqual(2); // 지훈 + 최장
    expect(within(card).getByText("환승 1번")).toBeInTheDocument();
    expect(within(card).getByText("환승 없음")).toBeInTheDocument();
    expect(within(card).getByText("1분")).toBeInTheDocument(); // 차이
    expect(within(card).getByText("1시간 15분")).toBeInTheDocument(); // 합계 37 + 38
    expect(within(card).getByText("가장 오래 걸리는 지훈도 38분이에요.")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: /지도에서 보기/ })).toHaveAttribute(
      "href",
      expect.stringMatching(/^https:\/\/map\.kakao\.com\/link\/map\//),
    );
  });

  it("2위 줄은 접힌 상태에서 최장·차이를 보인다", () => {
    const [, second] = view.candidates;
    if (!second) throw new Error("후보 없음");
    render(<OtherCandidateRow candidate={second} />);
    expect(screen.getByText("최장 42분, 차이 27분")).toBeInTheDocument();
  });

  it("나는 누구?를 고르면 내 줄이 맨 위로 오고 내 길찾기 링크가 생긴다", () => {
    const [top] = view.candidates;
    if (!top) throw new Error("후보 없음");
    render(<TopCandidateCard candidate={top} meIndex={1} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("지훈(나)");
    expect(screen.getByRole("link", { name: "내 길찾기" })).toHaveAttribute(
      "href",
      expect.stringMatching(/^https:\/\/map\.kakao\.com\/link\/by\/traffic\//),
    );
  });
});
