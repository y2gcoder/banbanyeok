// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { RecommendResult } from "@/lib/api/types";
import { toResultView } from "@/lib/result/view-model";
import { searchStations } from "@/lib/stations";
import { Candidates } from "./candidates";
import type { ChoiceContext } from "./directions";

const code = (name: string) => searchStations(name)[0]?.code ?? "000";

const resultOf = (hidden: boolean): RecommendResult => ({
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
      times: [
        { participantId: "0", seconds: 21 * 60, transfers: 1 },
        { participantId: "1", seconds: 22 * 60, transfers: 0 },
      ],
      maxSeconds: 22 * 60,
      spreadSeconds: 60,
      totalSeconds: 43 * 60,
      reasonCode: "FAIR_MINIMAX",
      reason: "가장 오래 걸리는 홍대입구에서 오는 분도 22분이에요.",
    },
  ],
});

const choice: ChoiceContext = { mode: "fair", participantCount: 2, variant: "creator" };

afterEach(() => window.history.replaceState(null, "", "/"));

describe("후보 목록의 반반지수 시안(#202)", () => {
  it("숨긴 참가자가 있으면 등급을 끄고(본인 21·22분), 없으면(대조군 21·22분) 보인다", async () => {
    window.history.replaceState(null, "", "/?bbi=toptwo");
    const control = render(<Candidates view={toResultView(resultOf(false))} meIndex={null} choice={choice} />);
    expect(await screen.findByText("딱 반반")).toBeVisible();
    control.unmount();

    render(<Candidates view={toResultView(resultOf(true))} meIndex={0} choice={choice} />);
    expect(await screen.findByRole("article", { name: "신촌" })).toBeVisible();
    expect(screen.queryByText("딱 반반")).toBeNull();
  });
});
