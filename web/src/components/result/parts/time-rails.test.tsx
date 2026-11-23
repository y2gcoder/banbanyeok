// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { toRouteView } from "@/lib/result/route";
import type { PersonTimeView } from "@/lib/result/view-model";
import { lineColor } from "@/lib/stations/lines";
import { TimeRails } from "./time-rails";

const stop = (stationCode: string, stationName: string) => ({ stationCode, stationName });

function person(index: number, route: PersonTimeView["route"], directionsUrl: string | null = null): PersonTimeView {
  return {
    index,
    name: `참가자 ${index + 1}`,
    shortName: `참가자 ${index + 1}`,
    labelKind: "ordinal",
    originName: null,
    originCode: null,
    seconds: 1200,
    minutes: 20,
    transfers: 2,
    shownTransfers: route ? route.lines.length - 1 : 2,
    route,
    directionsUrl,
  };
}

const route = toRouteView({
  participantId: "0",
  legs: [
    {
      line: "2호선",
      from: stop("a01", "을지로입구"),
      to: stop("a02", "동대문역사문화공원"),
      waitSeconds: 100,
      rideSeconds: 300,
    },
    {
      line: "4호선",
      from: stop("a02", "동대문역사문화공원"),
      to: stop("a03", "숙대입구"),
      waitSeconds: 200,
      rideSeconds: 600,
    },
  ],
});

describe("사람별 시간 막대(#120)", () => {
  it("경로가 있으면 노선 색 구간과 회색 대기 구간으로 칠하고, 막대 대신 읽을 글과 길찾기를 둔다", () => {
    const { container } = render(
      <TimeRails people={[person(0, route, "https://map.kakao.com/link/by/traffic/x")]} maxMinutes={20} rank={1} />,
    );
    const track = container.querySelector('[data-route="lines"]');
    expect(track).toHaveAttribute("aria-hidden", "true");
    const segments = [...(track?.querySelectorAll("[data-segment]") ?? [])] as HTMLElement[];
    expect(segments.map((s) => s.dataset.segment)).toEqual(["wait", "ride", "wait", "ride"]);
    // 칸 길이는 모델 시간의 비율이다(100 : 300 : 200 : 600).
    expect(segments.map((s) => s.style.width)).toEqual(["8.33333%", "25%", "16.6667%", "50%"]);
    expect(segments[1]?.style.backgroundColor).toBe(hexToRgb(lineColor("2호선")));
    const description = screen.getByText("참가자 1 경로: 2호선 → 동대문역사문화공원 환승 → 4호선");
    expect(description).toHaveClass("sr-only");
    // 구간 분은 숫자로 쓰지 않는다(경로 글에는 시간이 없다).
    expect(description.closest("p")?.textContent).not.toMatch(/분/);
    // 환승 글자는 보이는 경로를 따른다(od는 2번).
    expect(screen.getByText(/환승 1번/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "참가자 1 카카오맵 길찾기" })).toHaveAttribute(
      "href",
      "https://map.kakao.com/link/by/traffic/x",
    );
    expect(screen.getByText(/막대 색은 타는 노선/)).toBeInTheDocument();
  });

  it("경로를 모르면 지금처럼 중립색 막대이고 경로 글·안내는 없다", () => {
    const { container } = render(<TimeRails people={[person(0, null)]} maxMinutes={20} />);
    expect(container.querySelector('[data-route="neutral"]')).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector("[data-segment]")).toBeNull();
    expect(screen.queryByText(/경로:/)).toBeNull();
    expect(screen.queryByText(/막대 색은 타는 노선/)).toBeNull();
    expect(screen.getByText(/환승 2번/)).toBeInTheDocument();
  });
});

function hexToRgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}
