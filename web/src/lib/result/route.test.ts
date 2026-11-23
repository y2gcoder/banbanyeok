import { describe, expect, it } from "vitest";
import type { RecommendResult } from "@/lib/api/types";
import { describeRoute, toRouteView } from "./route";
import { toResultView } from "./view-model";

const stop = (stationCode: string, stationName: string) => ({ stationCode, stationName });

const viaTransfer = {
  participantId: "0",
  legs: [
    {
      line: "2호선",
      from: stop("a01", "을지로입구"),
      to: stop("a02", "동대문역사문화공원"),
      waitSeconds: 120,
      rideSeconds: 300,
    },
    {
      line: "4호선",
      from: stop("a02", "동대문역사문화공원"),
      to: stop("a03", "숙대입구"),
      waitSeconds: 210,
      rideSeconds: 600,
    },
  ],
};

describe("사람별 경로 화면 값(#120)", () => {
  it("노선 순서·환승역·막대 칸(대기는 회색, 타는 구간은 노선)과 글 설명을 만든다", () => {
    expect(toRouteView(viaTransfer)).toEqual({
      lines: ["2호선", "4호선"],
      transfers: ["동대문역사문화공원"],
      segments: [
        { kind: "wait", seconds: 120 },
        { kind: "ride", line: "2호선", seconds: 300 },
        { kind: "wait", seconds: 210 },
        { kind: "ride", line: "4호선", seconds: 600 },
      ],
      description: "2호선 → 동대문역사문화공원 환승 → 4호선",
    });
    expect(describeRoute(["신분당선"], [])).toBe("신분당선");
    expect(describeRoute(["1호선", "1호선", "4호선"], ["병점", "금정"])).toBe(
      "1호선 → 병점 환승 → 1호선 → 금정 환승 → 4호선",
    );
  });

  it("경로가 없거나 구간이 이어지지 않으면 null이다(중립색 막대로 떨어진다)", () => {
    expect(toRouteView(undefined)).toBeNull();
    expect(toRouteView({ participantId: "0", legs: [] })).toBeNull();
    const broken = {
      ...viaTransfer,
      legs: [viaTransfer.legs[0], { ...viaTransfer.legs[1], from: stop("zzz", "다른 역") }],
    };
    expect(toRouteView(broken as typeof viaTransfer)).toBeNull();
  });

  it("사람별 화면 값에 붙고, 환승 글자는 보이는 경로의 환승 수를 쓴다(분은 od 그대로)", () => {
    const result = {
      status: "ok",
      mode: "fair",
      dataVersion: "20261123.1",
      timeBasis: {
        timeSlot: "weekday-day",
        requestedTimeSlot: "weekday-day",
        dayType: "weekday",
        band: "day",
        label: "평일 낮",
        holidayName: null,
      },
      participants: ["0", "1", "2"].map((participantId) => ({
        participantId,
        hidden: participantId === "2",
        originCode: null,
        nickname: null,
        label: `참가자 ${participantId}`,
        labelKind: "ordinal" as const,
        shortLabel: `참가자 ${participantId}`,
      })),
      candidates: [
        {
          rank: 1,
          stationCode: "a03",
          stationName: "숙대입구",
          times: [
            { participantId: "0", seconds: 1125, transfers: 2 },
            { participantId: "1", seconds: 600, transfers: 0 },
            { participantId: "2", seconds: 900, transfers: 1 },
          ],
          maxSeconds: 1125,
          spreadSeconds: 525,
          totalSeconds: 2625,
          reasonCode: "FAIR_MINIMAX",
          reason: "",
          // 1번은 경로가 없고(그래프를 아직 읽는 중이었다고 치자), 숨긴 2번은 서버가 빼서 보냈다.
          routes: [viaTransfer],
        },
      ],
    } satisfies RecommendResult;
    const [a, b, hidden] = toResultView(result).candidates[0]?.people ?? [];
    expect(a?.route?.description).toBe("2호선 → 동대문역사문화공원 환승 → 4호선");
    expect([a?.transfers, a?.shownTransfers, a?.minutes]).toEqual([2, 1, 19]);
    expect([b?.route, b?.shownTransfers]).toEqual([null, 0]);
    expect([hidden?.route, hidden?.shownTransfers]).toEqual([null, 1]);
  });
});
