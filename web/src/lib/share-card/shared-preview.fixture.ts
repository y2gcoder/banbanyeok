import type { RecommendResult } from "@/lib/api/types";
import type { ShareState } from "@/lib/link/codec";

/** 공유 링크 미리보기 테스트가 함께 쓰는 표본(상태 하나와 그 결과). */
export const state: ShareState = {
  origins: ["1qs", "70x"],
  mode: "fair",
  favorIndex: null,
  nicknames: ["지훈🎂", null],
  timeSlot: "weekday-day",
};

export function result(overrides: Partial<RecommendResult> = {}): RecommendResult {
  const time = (seconds: number, transfers: number) => ({ seconds, transfers });
  return {
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
        originCode: "1qs",
        originName: "신촌",
        hidden: false,
        label: "지훈🎂",
        labelKind: "name",
        shortLabel: "지훈🎂",
      },
      {
        participantId: "1",
        originCode: "70x",
        originName: "잠실",
        hidden: false,
        label: "잠실에서 오는 분",
        labelKind: "origin",
        shortLabel: "잠실",
      },
    ],
    candidates: [
      {
        rank: 1,
        stationCode: "70x",
        stationName: "왕십리",
        times: [time(2040, 0), time(1800, 1)],
        maxSeconds: 2040,
        spreadSeconds: 240,
        totalSeconds: 3840,
        reasonCode: "FAIR_MINIMAX",
        reason: "가장 오래 걸리는 지훈🎂도 34분이에요.",
      },
    ],
    ...overrides,
  } as RecommendResult;
}
