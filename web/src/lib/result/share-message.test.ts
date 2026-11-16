import { describe, expect, it } from "vitest";
import type { RecommendResult } from "@/lib/api/types";
import { shareMessage } from "./share-message";
import { toResultView } from "./view-model";

const SATURDAY_NIGHT: RecommendResult["timeBasis"] = {
  timeSlot: "saturday-night",
  requestedTimeSlot: "saturday-night",
  dayType: "saturday",
  band: "night",
  label: "토요일 밤",
  holidayName: null,
};
const WEEKDAY_DAY: RecommendResult["timeBasis"] = {
  ...SATURDAY_NIGHT,
  timeSlot: "weekday-day",
  requestedTimeSlot: "weekday-day",
  dayType: "weekday",
  band: "day",
  label: "평일 낮",
};

const result = {
  status: "ok",
  mode: "fair",
  dataVersion: "20261115.8",
  baselineStationCode: null,
  timeBasis: WEEKDAY_DAY,
  participants: [
    {
      participantId: "0",
      hidden: false,
      originCode: "2je",
      originName: "혜화",
      label: "혜화에서 오는 분",
      labelKind: "origin",
      shortLabel: "혜화",
    },
    {
      participantId: "1",
      hidden: false,
      originCode: "k3a",
      originName: "강남",
      nickname: "민수",
      label: "민수",
      labelKind: "name",
      shortLabel: "민수",
    },
  ],
  candidates: [
    {
      rank: 1,
      stationCode: "jgn",
      stationName: "약수",
      times: [
        { participantId: "0", seconds: 1079, transfers: 1 },
        { participantId: "1", seconds: 1367, transfers: 1 },
      ],
      maxSeconds: 1367,
      spreadSeconds: 288,
      totalSeconds: 2446,
      reasonCode: "FAIR_MINIMAX",
      reason: "가장 오래 걸리는 민수도 23분이에요.",
    },
  ],
} as RecommendResult;

const top = toResultView(result).candidates[0];
if (!top) throw new Error("후보 없음");

describe("공유 문구", () => {
  it("제목은 제안하는 말투, 설명은 짧은 이름과 분, 그리고 기준 한 마디(탭 이름 + '로 고름'이 아니다)", () => {
    expect(shareMessage(top, "fair", null, WEEKDAY_DAY)).toEqual({
      title: "약수에서 볼까?",
      text: "혜화 18분 · 민수 23분 · 공평하게 고름",
    });
    expect(shareMessage(top, "fast", null, WEEKDAY_DAY).text).toBe("혜화 18분 · 민수 23분 · 가장 빠른 만남으로 고름");
    expect(shareMessage(top, "favor", "혜화", WEEKDAY_DAY).text).toBe("혜화 18분 · 민수 23분 · 혜화 쪽으로 고름");
  });

  it("평일 낮이 아닌 기준이면 끝에 '· {기준} 기준'을 붙이고, 평일 낮·기준 없음(옛 서버)은 붙이지 않는다", () => {
    expect(shareMessage(top, "fair", null, SATURDAY_NIGHT).text).toBe(
      "혜화 18분 · 민수 23분 · 공평하게 고름 · 토요일 밤 기준",
    );
    expect(shareMessage(top, "favor", "민수", SATURDAY_NIGHT).text).toBe(
      "혜화 18분 · 민수 23분 · 민수 쪽으로 고름 · 토요일 밤 기준",
    );
    expect(shareMessage(top, "fair", null).text).toBe("혜화 18분 · 민수 23분 · 공평하게 고름");
  });

  it("어느 모드에서도 어긋난 말('로 고름' 중복)이 없다", () => {
    for (const mode of ["fair", "fast", "favor"] as const) {
      const { text } = shareMessage(top, mode, "혜화", SATURDAY_NIGHT);
      expect(text).not.toMatch(/게로 고름|기로 고름|으로로 고름/);
    }
  });
});
