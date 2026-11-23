/**
 * 사람별 경로(#120)를 화면 값으로 바꾼다. 서버가 준 `Candidate.routes`(최단 + 2분 안에서 환승이 가장 적은 길)를 그대로 쓰고 다시 계산하지
 * 않는다. 구간 시간은 배차/2 평균 대기로 만든 모델 값이라 숫자로 보이지 않는다: 막대의 구간 길이 비율에만 쓴다.
 */
import type { ParticipantRoute } from "@/lib/api/types";

/** 막대의 한 칸. `wait`은 승강장 대기와 갈아타기(걷기 + 대기)이고 회색, `ride`는 노선 색이다. */
type RouteSegment = { kind: "wait"; seconds: number } | { kind: "ride"; line: string; seconds: number };

export type RouteView = {
  /** 탄 노선 순서. */
  lines: string[];
  /** 갈아탄 역 이름(`lines` 사이, 길이 = lines - 1). */
  transfers: string[];
  segments: RouteSegment[];
  /** 막대를 대신하는 글 설명: "2호선 → 동대문역사문화공원 환승 → 4호선". */
  description: string;
};

/** 서버 경로 → 화면 값. 구간이 없거나 이어지지 않으면 null(모르면 끈다: 중립색 막대로 그린다). */
export function toRouteView(route: ParticipantRoute | undefined): RouteView | null {
  const legs = route?.legs ?? [];
  if (legs.length === 0) return null;
  const linked = legs.every((leg, i) => i === 0 || legs[i - 1]?.to.stationCode === leg.from.stationCode);
  if (!linked || legs.some((leg) => leg.rideSeconds <= 0 || leg.waitSeconds < 0)) return null;
  const lines = legs.map((leg) => leg.line);
  const transfers = legs.slice(0, -1).map((leg) => leg.to.stationName);
  const segments = legs.flatMap((leg): RouteSegment[] => [
    ...(leg.waitSeconds > 0 ? [{ kind: "wait" as const, seconds: leg.waitSeconds }] : []),
    { kind: "ride", line: leg.line, seconds: leg.rideSeconds },
  ]);
  return { lines, transfers, segments, description: describeRoute(lines, transfers) };
}

/** "2호선" / "2호선 → 동대문역사문화공원 환승 → 4호선". */
export function describeRoute(lines: readonly string[], transfers: readonly string[]): string {
  return lines.map((line, i) => (i === 0 ? line : `${transfers[i - 1]} 환승 → ${line}`)).join(" → ");
}
