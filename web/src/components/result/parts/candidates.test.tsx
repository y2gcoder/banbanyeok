// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Mode, RecommendResult } from "@/lib/api/types";
import { toResultView } from "@/lib/result/view-model";
import { searchStations } from "@/lib/stations";
import { Candidates } from "./candidates";
import type { ChoiceContext } from "./directions";

const code = (name: string) => searchStations(name)[0]?.code ?? "000";

function resultOf({
  mode = "fair",
  minutes,
  hidden = false,
}: {
  mode?: Mode;
  minutes: [number, number];
  hidden?: boolean;
}): RecommendResult {
  const seconds = minutes.map((m) => m * 60);
  return {
    status: "ok",
    mode,
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
        hidden,
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
        times: seconds.map((s, i) => ({ participantId: String(i), seconds: s, transfers: 0 })),
        maxSeconds: Math.max(...seconds),
        spreadSeconds: Math.max(...seconds) - Math.min(...seconds),
        totalSeconds: seconds.reduce((a, b) => a + b, 0),
        reasonCode: "FAIR_MINIMAX",
        reason: "가장 오래 걸리는 사람의 시간이 가장 짧아요.",
      },
    ],
  };
}

const choiceOf = (mode: Mode): ChoiceContext => ({ mode, participantCount: 2, variant: "creator" });

function topCard(result: RecommendResult, meIndex: number | null = null) {
  render(<Candidates view={toResultView(result)} meIndex={meIndex} choice={choiceOf(result.mode)} />);
  const card = screen.getByRole("article", { name: "신촌" });
  return { card, bars: card.querySelectorAll("[data-bar]").length };
}

describe("1위 카드의 반반지수(#202)", () => {
  it("공평하게: 최장·차이 줄 대신 기본 층 문장, 사람마다 막대", () => {
    const { card, bars } = topCard(resultOf({ minutes: [19, 31] }));
    expect(within(card).getByText("가장 오래 걸리는 사람도 31분이에요")).toBeVisible();
    expect(within(card).queryByText("최장")).toBeNull();
    expect(within(card).queryByText("차이")).toBeNull();
    expect(bars).toBe(2);
  });

  it("걸리는 시간이 고르면 그 줄이 강조 층 문장으로 바뀐다", () => {
    const { card } = topCard(resultOf({ minutes: [21, 22] }));
    expect(within(card).getByText("걸리는 시간이 두 사람 1분 차이예요")).toBeVisible();
    expect(within(card).queryByText(/가장 오래 걸리는 사람도/)).toBeNull();
  });

  it("숨긴 참가자가 있으면(본인 화면 21·22분) 끄고 최장·차이 줄을 그대로 둔다", () => {
    const { card, bars } = topCard(resultOf({ minutes: [21, 22], hidden: true }), 0);
    expect(within(card).queryByText(/걸리는 시간이|가장 오래 걸리는 사람도/)).toBeNull();
    expect(within(card).getByText("최장")).toBeVisible();
    expect(within(card).getByText("차이")).toBeVisible();
    expect(bars).toBe(0);
  });

  it("빨리 만나기에는 없다(합계·최장 줄 그대로)", () => {
    const { card, bars } = topCard(resultOf({ mode: "fast", minutes: [21, 22] }));
    expect(within(card).queryByText(/걸리는 시간이|가장 오래 걸리는 사람도/)).toBeNull();
    expect(within(card).getByText("합계")).toBeVisible();
    expect(bars).toBe(0);
  });
});
