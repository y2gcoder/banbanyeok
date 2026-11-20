// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RecommendResult } from "@/lib/api/types";
import { toResultView } from "@/lib/result/view-model";
import { TopCandidateCard } from "./candidate-card";
import type { ChoiceContext } from "./directions";

const choice: ChoiceContext = { mode: "fair", participantCount: 2, variant: "creator" };

function result(overrides: Partial<RecommendResult> = {}, withMiddle = true): RecommendResult {
  return {
    status: "ok",
    mode: "fair",
    dataVersion: "20261120.1",
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
        originCode: "ryf",
        originName: "홍대입구",
        label: "홍대입구에서 오는 분",
        labelKind: "origin",
        shortLabel: "홍대입구",
      },
      {
        participantId: "1",
        hidden: false,
        originCode: "dxy",
        originName: "잠실",
        nickname: "잠실러",
        label: "잠실러",
        labelKind: "name",
        shortLabel: "잠실러",
      },
    ],
    candidates: [
      {
        rank: 1,
        stationCode: "5d2",
        stationName: "신당",
        times: [
          { participantId: "0", seconds: 1260, transfers: 1 },
          { participantId: "1", seconds: 1260, transfers: 1 },
        ],
        maxSeconds: 1260,
        spreadSeconds: 0,
        totalSeconds: 2520,
        reasonCode: "FAIR_MINIMAX",
        reason: "가장 오래 걸리는 분도 21분이에요.",
      },
    ],
    ...(withMiddle
      ? {
          mapMiddle: {
            stationCode: "j7v",
            stationName: "한강진",
            times: [
              { participantId: "0", seconds: 1380, transfers: 1 },
              { participantId: "1", seconds: 2100, transfers: 1 },
            ],
          },
        }
      : {}),
    ...overrides,
  } as RecommendResult;
}

function top(r: RecommendResult) {
  const view = toResultView(r);
  const [first] = view.candidates;
  if (!first) throw new Error("후보 없음");
  return { view, first };
}

describe("지도 한가운데였다면? 표", () => {
  it("1위 카드 안에 추천 역·지도 한가운데 역 열과 사람별 시간, 마지막 줄 '가장 오래'를 그린다", () => {
    const { view, first } = top(result());
    render(<TopCandidateCard candidate={first} choice={choice} mapMiddle={view.mapMiddle} />);
    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: /추천\s*신당/ })).toBeTruthy();
    expect(within(table).getByRole("columnheader", { name: /지도 한가운데\s*한강진/ })).toBeTruthy();
    const rows = within(table).getAllByRole("row");
    // 머리 + 사람 2명 + 가장 오래
    expect(rows).toHaveLength(4);
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("한강진"),
      "홍대입구21분23분",
      "잠실러21분35분",
      "가장 오래21분35분",
    ]);
    expect(within(table).queryByText("차이")).toBeNull(); // 마지막 줄은 "차이"가 아니라 "가장 오래"
  });

  it("비교 문장과 설명 한 줄이 표 아래에 있다", () => {
    const { view, first } = top(result());
    render(<TopCandidateCard candidate={first} choice={choice} mapMiddle={view.mapMiddle} />);
    expect(screen.getByText("지도 한가운데인 한강진역이면 잠실러는 14분 더 걸려요")).toBeTruthy();
    expect(screen.getByText("지도 한가운데는 출발역 위치의 평균에 가장 가까운 역이에요.")).toBeTruthy();
  });

  it("mapMiddle이 없으면(옛 서버·조건 미달) 표도 문장도 빠진다", () => {
    const { view, first } = top(result({}, false));
    expect(view.mapMiddle).toBeNull();
    render(<TopCandidateCard candidate={first} choice={choice} mapMiddle={view.mapMiddle} />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText(/지도 한가운데/)).toBeNull();
  });

  it("5분보다 적게 늘었거나 공평 기준이 아니면 빠진다", () => {
    const small = top(
      result({
        mapMiddle: {
          stationCode: "j7v",
          stationName: "한강진",
          times: [
            { participantId: "0", seconds: 1380, transfers: 1 },
            { participantId: "1", seconds: 1500, transfers: 1 },
          ],
        },
      }),
    );
    expect(small.view.mapMiddle).toBeNull();
    expect(top(result({ mode: "fast" })).view.mapMiddle).toBeNull();
  });

  it("긴 이름이 '가장 오래 걸리는 사람'으로 바뀌는 건 그림 문장의 규칙이며, 화면도 같은 문장 규칙(6자 초과)을 쓴다", () => {
    const base = result();
    const [first, second] = base.participants;
    if (!first || !second) throw new Error("표본");
    const long = result({
      participants: [
        first,
        {
          ...second,
          nickname: "우리팀막내생일축하해요",
          label: "우리팀막내생일축하해요",
          shortLabel: "우리팀막내생일축하해요",
        },
      ],
    });
    const { view, first: card } = top(long);
    render(<TopCandidateCard candidate={card} choice={choice} mapMiddle={view.mapMiddle} />);
    expect(screen.getByText("지도 한가운데인 한강진역이면 가장 오래 걸리는 사람은 14분 더 걸려요")).toBeTruthy();
  });
});
