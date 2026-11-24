// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { RecommendResult } from "@/lib/api/types";
import { toResultView } from "@/lib/result/view-model";
import { searchStations } from "@/lib/stations";
import { OtherCandidateRow, TopCandidateCard } from "./candidate-card";
import type { ChoiceContext } from "./directions";
import { railScale } from "./time-rails";

const code = (name: string) => searchStations(name)[0]?.code ?? "000";

const result: RecommendResult = {
  status: "ok",
  mode: "fair",
  dataVersion: "20261112.6",
  timeBasis: {
    timeSlot: "weekday-day",
    requestedTimeSlot: "weekday-day",
    dayType: "weekday",
    band: "day",
    label: "평일 낮",
    holidayName: null,
  },
  participants: [
    {
      participantId: "0",
      hidden: false,
      originCode: code("강남"),
      originName: "강남",
      nickname: "민지",
      label: "민지",
      labelKind: "name",
      shortLabel: "민지",
    },
    {
      participantId: "1",
      hidden: false,
      originCode: code("홍대입구"),
      originName: "홍대입구",
      nickname: null,
      label: "홍대입구에서 오는 분",
      labelKind: "origin",
      shortLabel: "홍대입구",
    },
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
      reason: "가장 오래 걸리는 홍대입구에서 오는 분도 38분이에요.",
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
  const view = toResultView(result);
  const choice: ChoiceContext = { mode: "fair", participantCount: 2, variant: "creator" };

  it("1위 카드는 요약이 먼저다: 사람별 표시 분·환승, 순위 기준 값(최장·차이), 정하기·길찾기. 합계는 공평 모드에서 빠진다", () => {
    const [top] = view.candidates;
    if (!top) throw new Error("후보 없음");
    render(<TopCandidateCard candidate={top} choice={choice} />);
    const card = screen.getByRole("article", { name: "신촌" });
    const [people] = within(card).getAllByRole("list");
    if (!people) throw new Error("사람 목록 없음");
    const rows = within(people).getAllByRole("listitem");
    // 시간 행 이름은 서버 짧은 이름(shortLabel) 그대로이고, 출발역 이름이면 옆에 출발역을 되풀이하지 않는다.
    expect(rows.map((row) => row.textContent)).toEqual(["민지강남에서 · 환승 1번37분", "홍대입구환승 없음38분"]);
    // 반올림한 분에서 계산한 최장·차이(2249초 → 37분, 2250초 → 38분: 차이 1분).
    const stats = within(card)
      .getAllByRole("term")
      .map((term) => `${term.textContent}${term.nextSibling?.textContent}`);
    expect(stats).toEqual(["최장38분", "차이1분"]);
    // 합계는 공평 순위와 상관없어 공평 모드에서 보이지 않는다(#122).
    expect(within(card).queryByText("1시간 15분")).toBeNull();
    expect(within(card).getByRole("button", { name: /이 역으로 정했어요/ })).toBeVisible();
    expect(within(card).getByRole("button", { name: /카카오맵 길찾기/ })).toBeVisible();
    expect(within(card).getByRole("link", { name: /지도에서 보기/ })).toHaveAttribute(
      "href",
      expect.stringMatching(/^https:\/\/map\.kakao\.com\/link\/map\//),
    );
  });

  it("빨리 만나기에서는 순위 기준인 합계를 앞에 둔다(1위 카드·2위 줄 모두)", () => {
    const fast: ChoiceContext = { ...choice, mode: "fast" };
    const [top, second] = view.candidates;
    if (!top || !second) throw new Error("후보 없음");
    render(<TopCandidateCard candidate={top} choice={fast} />);
    const stats = screen.getAllByRole("term").map((term) => `${term.textContent}${term.nextSibling?.textContent}`);
    expect(stats).toEqual(["합계1시간 15분", "최장38분"]);
    render(<OtherCandidateRow candidate={second} choice={fast} />);
    expect(screen.getByText("합계 57분, 최장 42분")).toBeInTheDocument();
  });

  it("'자세히'(aria-expanded)를 펴면 시간 막대·추천 이유가 보이고, 다시 접을 수 있다", async () => {
    const user = userEvent.setup();
    const [top] = view.candidates;
    if (!top) throw new Error("후보 없음");
    render(<TopCandidateCard candidate={top} choice={choice} />);
    const more = screen.getByRole("button", { name: /자세히/ });
    expect(more).toHaveAttribute("aria-expanded", "false");
    const panel = document.getElementById(more.getAttribute("aria-controls") ?? "");
    expect(panel).not.toBeVisible();
    await user.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(more).toHaveFocus();
    expect(panel).toBeVisible();
    // 모든 트랙이 같은 눈금: 최장 38분 → 0~40분 자
    expect(within(panel as HTMLElement).getByText("40분")).toBeVisible();
    expect(within(panel as HTMLElement).getByText("가장 오래 걸리는 홍대입구에서 오는 분도 38분이에요.")).toBeVisible();
    await user.click(more);
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(panel).not.toBeVisible();
  });

  it("고른 사람이 없으면 (나)를 붙이지 않는다", () => {
    const [top] = view.candidates;
    if (!top) throw new Error("후보 없음");
    render(<TopCandidateCard candidate={top} choice={choice} />);
    expect(screen.queryByText("(나)")).toBeNull();
  });

  it("나는 누구?를 고르면 내 줄이 맨 위로 오고 내 길찾기 링크가 생긴다", () => {
    const [top] = view.candidates;
    if (!top) throw new Error("후보 없음");
    render(<TopCandidateCard candidate={top} choice={choice} meIndex={1} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("홍대입구(나)");
    expect(rows[1]).not.toHaveTextContent("(나)");
    expect(screen.getByRole("link", { name: "내 길찾기" })).toHaveAttribute(
      "href",
      expect.stringMatching(/^https:\/\/map\.kakao\.com\/link\/by\/traffic\//),
    );
  });
});

describe("시간 행 눈금", () => {
  it("끝 눈금은 최장 시간을 눈금 간격으로 올린 값이다(가장 오래 걸리는 사람 = 끝이 아니다)", () => {
    expect(railScale(31)).toEqual({ end: 40, step: 10 });
    expect(railScale(30)).toEqual({ end: 30, step: 10 });
    expect(railScale(0)).toEqual({ end: 10, step: 10 });
    expect(railScale(75)).toEqual({ end: 80, step: 20 });
    expect(railScale(130)).toEqual({ end: 150, step: 30 });
  });
});

describe("출발역을 숨긴 다른 사람의 칸(#142)", () => {
  // 서버는 숨긴 다른 사람의 시간을 5분 단위로 뭉뚱그려(0분도 5분) 주고 환승은 null로 준다. 화면은 받은 값을 그대로 쓰고 환승은 쓰지 않는다.
  const hiddenResult: RecommendResult = {
    ...result,
    participants: [
      result.participants[0] as RecommendResult["participants"][number],
      {
        participantId: "1",
        hidden: true,
        originCode: null,
        originName: null,
        nickname: "지연",
        label: "지연",
        labelKind: "name",
        shortLabel: "지연",
      },
    ],
    candidates: [
      {
        rank: 1,
        stationCode: code("신당"),
        stationName: "신당",
        times: [
          { participantId: "0", seconds: 1271, transfers: 0 },
          { participantId: "1", seconds: 300, transfers: null },
        ],
        maxSeconds: 1271,
        spreadSeconds: 971,
        totalSeconds: 1571,
        reasonCode: "FAIR_MINIMAX",
        reason: "가장 오래 걸리는 민지도 21분이에요.",
      },
    ],
  };

  it("시간은 받은 값(5분)이고, 환승 글 없이 '출발역 비공개'만 쓰며, 요약도 그 값으로 계산한다", async () => {
    const user = userEvent.setup();
    const [top] = toResultView(hiddenResult).candidates;
    if (!top) throw new Error("후보 없음");
    expect(top.people[1]).toMatchObject({ minutes: 5, transfers: null, shownTransfers: null });
    render(<TopCandidateCard candidate={top} choice={{ mode: "fair", participantCount: 2, variant: "creator" }} />);
    const card = screen.getByRole("article", { name: "신당" });
    const [people] = within(card).getAllByRole("list");
    if (!people) throw new Error("사람 목록 없음");
    expect(
      within(people)
        .getAllByRole("listitem")
        .map((row) => row.textContent),
    ).toEqual(["민지강남에서 · 환승 없음21분", "지연출발역 비공개5분"]);
    const stats = within(card)
      .getAllByRole("term")
      .map((term) => `${term.textContent}${term.nextSibling?.textContent}`);
    expect(stats).toEqual(["최장21분", "차이16분"]);
    // '자세히'의 시간 막대 줄도 환승 글 없이 출발역 비공개만 쓴다.
    await user.click(screen.getByRole("button", { name: /자세히/ }));
    expect(within(card).getAllByText("출발역 비공개")).toHaveLength(2);
    expect(within(card).queryByText(/출발역 비공개 ·/)).toBeNull();
  });
});
