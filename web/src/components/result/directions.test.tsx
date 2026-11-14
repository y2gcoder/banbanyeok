// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { track } from "@/lib/analytics";
import type { RecommendResult } from "@/lib/api/types";
import { toResultView } from "@/lib/result/view-model";
import { searchStations } from "@/lib/stations";
import { TopCandidateCard } from "./candidate-card";
import type { ChoiceContext } from "./directions";

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

const code = (name: string) => searchStations(name)[0]?.code ?? "000";

const result: RecommendResult = {
  status: "ok",
  mode: "fair",
  dataVersion: "20261112.6",
  participants: [
    {
      participantId: "0",
      hidden: false,
      originCode: code("강남"),
      originName: "강남",
      nickname: "민지",
      label: "민지",
      labelKind: "name",
    },
    {
      participantId: "1",
      hidden: false,
      originCode: code("홍대입구"),
      originName: "홍대입구",
      nickname: null,
      label: "홍대입구에서 오는 분",
      labelKind: "origin",
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

const choice: ChoiceContext = { mode: "fair", participantCount: 2, variant: "creator" };

function topOf(view: ReturnType<typeof toResultView>) {
  const [top] = view.candidates;
  if (!top) throw new Error("후보 없음");
  return top;
}

describe("이 역으로 정했어요", () => {
  beforeEach(() => vi.mocked(track).mockClear());

  it("누르면 station_chosen을 보내고 사람별 길찾기 목록을 연다(출발역·이름은 속성에 없다)", async () => {
    const user = userEvent.setup();
    const top = topOf(toResultView(result));
    render(<TopCandidateCard candidate={top} choice={choice} />);
    await user.click(screen.getByRole("button", { name: "이 역으로 정했어요" }));
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("station_chosen", {
      rank: 1,
      meeting_station_code: top.stationCode,
      mode: "fair",
      participant_count: 2,
      link_variant: "creator",
    });
    expect(await screen.findByText("정했어요! 각자 길찾기로 이어가요")).toBeInTheDocument();
    const routes = screen.getAllByRole("link", { name: /→ 신촌/ });
    expect(routes).toHaveLength(2);
    expect(routes[0]).toHaveAttribute("href", expect.stringMatching(/^https:\/\/map\.kakao\.com\/link\/by\/traffic\//));
  });

  it("목록을 닫았다 다시 열어도 한 번만 센다", async () => {
    const user = userEvent.setup();
    render(<TopCandidateCard candidate={topOf(toResultView(result))} choice={choice} />);
    const button = screen.getByRole("button", { name: "이 역으로 정했어요" });
    await user.click(button);
    await user.keyboard("{Escape}");
    await user.click(button);
    expect(vi.mocked(track).mock.calls.filter(([name]) => name === "station_chosen")).toHaveLength(1);
  });

  it("받은 링크에서 나를 고른 경우: 내 길찾기가 열리고 지도 열기도 함께 센다", async () => {
    const user = userEvent.setup();
    const top = topOf(toResultView(result));
    render(<TopCandidateCard candidate={top} choice={{ ...choice, variant: "received" }} meIndex={1} />);
    const link = screen.getByRole("link", { name: "이 역으로 정했어요" });
    expect(link).toHaveAttribute("href", expect.stringMatching(/^https:\/\/map\.kakao\.com\/link\/by\/traffic\//));
    link.addEventListener("click", (event) => event.preventDefault()); // jsdom이 새 창을 열지 않게
    await user.click(link);
    expect(track).toHaveBeenCalledWith(
      "station_chosen",
      expect.objectContaining({ link_variant: "received", rank: 1 }),
    );
    expect(track).toHaveBeenCalledWith("map_app_opened", { app: "kakao", rank: 1 });
  });

  it("길찾기를 열 수 없는 카드(출발역 숨김)는 눌렀다는 표시와 이벤트만 남긴다", async () => {
    const user = userEvent.setup();
    const hidden = topOf(toResultView(result));
    render(
      <TopCandidateCard
        candidate={{ ...hidden, people: hidden.people.map((p) => ({ ...p, directionsUrl: null })) }}
        choice={choice}
      />,
    );
    await user.click(screen.getByRole("button", { name: "이 역으로 정했어요" }));
    await user.click(screen.getByRole("button", { name: "정했어요!" }));
    expect(track).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "정했어요!" })).toHaveAttribute("aria-pressed", "true");
  });
});
