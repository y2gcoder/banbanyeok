// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RoomDraw } from "@/lib/room/draw";
import { FavorDrawCard, type FavorDrawCardProps } from "./favor-draw-card";
import { LADDER_PLAY_MS } from "./ladder-game";

const people: RoomDraw["candidates"] = [
  { id: "p1", name: "민수", personIndex: 0, left: false },
  { id: "p2", name: "지영", personIndex: 1, left: false },
  { id: "p4", name: "하늘", personIndex: 3, left: false },
];

const pending: RoomDraw = {
  key: "0:0",
  generation: 0,
  round: 0,
  maxRounds: 2,
  candidates: people,
  winner: null,
  winnerId: null,
  hiddenNames: ["참가자 3"],
  late: [],
  selfLate: false,
  drawnAt: null,
};

const drawn: RoomDraw = {
  ...pending,
  key: "0:1",
  round: 1,
  winner: 1,
  winnerId: "p2",
  drawnAt: "2026-11-25T11:14:00Z",
};

function card(over: Partial<FavorDrawCardProps> = {}) {
  const props: FavorDrawCardProps = {
    roomId: "qt7yvmsht3",
    draw: pending,
    variant: "summary",
    viewer: "host",
    full: true,
    joinedCount: 4,
    expectedCount: 4,
    hiddenInRoom: false,
    pending: false,
    error: null,
    onDraw: vi.fn(),
    onPlayed: vi.fn(),
    ...over,
  };
  const view = render(<FavorDrawCard {...props} />);
  return {
    props,
    rerender: (next: Partial<FavorDrawCardProps>) => view.rerender(<FavorDrawCard {...props} {...next} />),
  };
}

function reduceMotion(on: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: on && query.includes("reduce"),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

const REJECTED = "그사이 방이 바뀌었어요. 새로 불러왔으니 다시 골라 주세요.";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("'누구 쪽으로' 뽑기 카드(#172)", () => {
  it("뽑기 전에는 한 줄로 접혀 있고(방장은 바로 뽑을 수 있음), 펼치면 숨긴 사람이 빠진 이유가 보인다", () => {
    reduceMotion(false);
    card();
    expect(screen.getByRole("heading", { name: "누구 쪽으로 뽑기 전" })).toBeTruthy();
    const toggle = screen.getByRole("button", { name: "뽑기 자세히 보기" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText(/뽑기에서 빠졌어요/)).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByText(/참가자 3은 출발역을 숨겨서/)).toBeTruthy();
  });

  it("뽑기를 누르면 초점이 카드 제목에 남고, 서버가 거절하면 오류 안내로 옮긴다", () => {
    reduceMotion(false);
    const { props, rerender } = card();
    fireEvent.click(screen.getByRole("button", { name: "사다리 타기" }));
    expect(props.onDraw).toHaveBeenCalledWith(0, 1);
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "누구 쪽으로 뽑기 전" }));
    rerender({ pending: true });
    rerender({ pending: false, error: REJECTED });
    expect(document.activeElement).toBe(screen.getByRole("alert"));
  });

  it("다른 참가자는 뽑기 버튼이 없다", () => {
    reduceMotion(false);
    card({ viewer: "member" });
    fireEvent.click(screen.getByRole("button", { name: "뽑기 자세히 보기" }));
    expect(screen.queryByRole("button", { name: "사다리 타기" })).toBeNull();
    expect(screen.getByText(/방장이 곧 뽑아요/)).toBeTruthy();
  });

  it("처음 보는 뽑기: 펼쳐 재생하고, 그림 이름은 재생 중에 당첨자를 말하지 않으며, 건너뛰면 초점이 카드 안이었다고 알린다", () => {
    reduceMotion(false);
    const { props } = card({ draw: drawn, variant: "play", focusOnMount: "skip" });
    const skip = screen.getByRole("button", { name: "건너뛰고 결과 보기" });
    expect(document.activeElement).toBe(skip);
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe("사다리타기: 민수, 지영, 하늘 중 한 사람");
    fireEvent.click(skip);
    expect(props.onPlayed).toHaveBeenCalledTimes(1);
    expect(props.onPlayed).toHaveBeenCalledWith(true);
  });

  it("재생은 카드가 끝낸다: 뽑을 때의 대상 중 나간 사람이 있어도 약 3초 뒤 끝난다", () => {
    reduceMotion(false);
    vi.useFakeTimers();
    const gone = { id: "~2", name: "나간 사람", personIndex: null, left: true };
    const { props } = card({
      draw: { ...drawn, candidates: [people[0], people[1], gone] as RoomDraw["candidates"] },
      variant: "play",
    });
    expect(screen.getByRole("heading", { name: "뽑는 중…" })).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(LADDER_PLAY_MS + 300);
    });
    expect(props.onPlayed).toHaveBeenCalledTimes(1);
  });

  it("이미 본 뽑기는 접힌 한 줄 결과이고, 펼치면 움직이지 않는 사다리, 다시 보기가 끝나면 제목에 초점이 간다", () => {
    reduceMotion(false);
    vi.useFakeTimers();
    card({ draw: drawn, viewer: "member" });
    expect(screen.getByRole("heading", { name: "지영 쪽으로!" })).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
    const open = screen.getByRole("button", { name: "사다리 결과 보기" });
    expect(open).toHaveTextContent(/^사다리 결과 보기$/);
    fireEvent.click(open);
    expect(screen.getByText(/방장이 뽑았어요 · 20:14/)).toBeVisible();
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe("사다리타기 결과: 지영 쪽으로");
    fireEvent.click(screen.getByRole("button", { name: "다시 보기" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "건너뛰고 결과 보기" }));
    act(() => {
      vi.advanceTimersByTime(LADDER_PLAY_MS + 300);
    });
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "지영 쪽으로!" }));
  });

  it("혼자 남은 방장도 이전 결과를 볼 수 있고 다시 뽑기는 표시되지 않는다", () => {
    reduceMotion(false);
    card({ draw: drawn, joinedCount: 1 });
    fireEvent.click(screen.getByRole("button", { name: "사다리 결과 보기" }));
    expect(screen.getByRole("img", { name: "사다리타기 결과: 지영 쪽으로" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /다시 뽑기/ })).toBeNull();
  });

  it("방장의 다시 뽑기: 확인으로 초점이 가고, 취소하면 원래 버튼으로, 확정 뒤 서버가 거절하면 오류 안내로 간다", () => {
    reduceMotion(false);
    const { props, rerender } = card({ draw: drawn });
    fireEvent.click(screen.getByRole("button", { name: "사다리 결과 보기" }));
    fireEvent.click(screen.getByRole("button", { name: "다시 뽑기 (1번 남음)" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "다시 뽑기" }));
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "다시 뽑기 (1번 남음)" }));
    fireEvent.click(screen.getByRole("button", { name: "다시 뽑기 (1번 남음)" }));
    fireEvent.click(screen.getByRole("button", { name: "다시 뽑기" }));
    expect(props.onDraw).toHaveBeenCalledWith(0, 2);
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "지영 쪽으로!" }));
    rerender({ pending: true });
    rerender({ pending: false, error: REJECTED });
    expect(document.activeElement).toBe(screen.getByRole("alert"));
  });

  it("숨긴 사람이 있는 방에서는 배려 상한 문장을 그 사람을 빼고 말하고, 숨긴 채 뒤늦게 온 사람은 다시 뽑아도 들어간다고 하지 않는다", () => {
    reduceMotion(false);
    const late = {
      ...drawn,
      late: [
        { name: "서준", hidden: false },
        { name: "참가자 5", hidden: true },
      ],
    };
    card({ draw: late, hiddenInRoom: true });
    fireEvent.click(screen.getByRole("button", { name: "사다리 결과 보기" }));
    expect(screen.getByText(/출발역을 숨긴 사람을 빼면, 다른 사람도 공평 1위보다 15분/)).toBeTruthy();
    expect(screen.getByText("서준, 참가자 5가 뽑기 뒤에 들어왔어요. 다시 뽑으면 서준도 함께 들어가요.")).toBeTruthy();
  });

  it("다시 뽑은 결과는 모두에게 '다시 뽑음'으로 보이고, 더 뽑을 수 없다", () => {
    reduceMotion(false);
    card({ draw: { ...drawn, round: 2, key: "0:2" } });
    expect(screen.getByText("다시 뽑음", { exact: true })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "사다리 결과 보기" }));
    expect(screen.queryByRole("button", { name: /다시 뽑기/ })).toBeNull();
  });
});
