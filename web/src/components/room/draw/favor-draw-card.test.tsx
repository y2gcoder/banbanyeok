// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RoomDraw } from "@/lib/room/draw";
import { FavorDrawCard, type FavorDrawCardProps } from "./favor-draw-card";
import { LADDER_PLAY_MS } from "./ladder-game";

const people = [
  { id: "p1", name: "민수", personIndex: 0 },
  { id: "p2", name: "지영", personIndex: 1 },
  { id: "p4", name: "하늘", personIndex: 3 },
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
  lateNames: [],
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
    viewer: "host",
    full: true,
    joinedCount: 4,
    expectedCount: 4,
    seen: false,
    justDrew: false,
    pending: false,
    error: null,
    onDraw: vi.fn(),
    onSettled: vi.fn(),
    ...over,
  };
  render(<FavorDrawCard {...props} />);
  return props;
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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("'누구 쪽으로' 뽑기 카드(#172)", () => {
  it("뽑기 전: 방장은 사다리 타기를 누를 수 있고(다음 회차로), 숨긴 사람이 빠진 이유가 보이며, 자리 잡으면 공평하게로 한 번 알린다", () => {
    reduceMotion(false);
    const props = card();
    expect(screen.getByRole("heading", { name: "누구 쪽으로 할지 뽑아요" })).toBeTruthy();
    expect(screen.getByText(/참가자 3은 출발역을 숨겨서 뽑기에서 빠졌어요/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "사다리 타기" }));
    expect(props.onDraw).toHaveBeenCalledWith(0, 1);
    expect(props.onSettled).toHaveBeenCalledTimes(1);
    expect(props.onSettled).toHaveBeenCalledWith(pending);
  });

  it("다른 참가자는 뽑기 버튼이 없고 방장이 곧 뽑는다고 본다", () => {
    reduceMotion(false);
    card({ viewer: "member" });
    expect(screen.queryByRole("button", { name: "사다리 타기" })).toBeNull();
    expect(screen.getByText(/방장이 곧 뽑아요/)).toBeTruthy();
  });

  it("처음 보는 결과는 그림을 한 번 재생하고, 건너뛰면 결과 문장을 한 번 읽고 초점을 제목으로 옮긴다", () => {
    reduceMotion(false);
    const props = card({ draw: drawn, justDrew: true });
    const skip = screen.getByRole("button", { name: "건너뛰고 결과 보기" });
    expect(document.activeElement).toBe(skip);
    expect(props.onSettled).not.toHaveBeenCalled();
    fireEvent.click(skip);
    const heading = screen.getByRole("heading", { name: "지영 쪽으로!" });
    expect(document.activeElement).toBe(heading);
    expect(screen.getByText("뽑기 결과, 오늘은 지영 쪽으로 맞춰요.").closest("[aria-live]")).toBeTruthy();
    expect(props.onSettled).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("img", { name: "사다리타기 결과: 지영 쪽으로" })).toBeTruthy();
  });

  it("그림이 끝나면(약 3초) 결과가 보인다", () => {
    reduceMotion(false);
    vi.useFakeTimers();
    const props = card({ draw: drawn });
    act(() => {
      vi.advanceTimersByTime(LADDER_PLAY_MS + 300);
    });
    expect(screen.getByRole("heading", { name: "지영 쪽으로!" })).toBeTruthy();
    expect(props.onSettled).toHaveBeenCalledTimes(1);
  });

  it("동작 줄이기면 그림 없이 곧바로 결과이고 다시 보기도 없다", () => {
    reduceMotion(true);
    const props = card({ draw: drawn });
    expect(screen.getByRole("heading", { name: "지영 쪽으로!" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "건너뛰고 결과 보기" })).toBeNull();
    expect(screen.queryByRole("button", { name: /다시 보기/ })).toBeNull();
    expect(props.onSettled).toHaveBeenCalledTimes(1);
  });

  it("이미 본 결과는 그림을 접어 두고, 방장의 다시 뽑기는 한 번 더 묻는다", () => {
    reduceMotion(false);
    const props = card({ draw: drawn, seen: true });
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText(/방장이 뽑았어요 · 20:14/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "다시 뽑기 (1번 남음)" }));
    expect(props.onDraw).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "다시 뽑기" }));
    expect(props.onDraw).toHaveBeenCalledWith(0, 2);
  });

  it("다시 뽑은 결과는 모두에게 '다시 뽑음'으로 보이고, 더 뽑을 수 없다", () => {
    reduceMotion(false);
    card({ draw: { ...drawn, round: 2, key: "0:2" }, seen: true });
    expect(screen.getByText("다시 뽑음")).toBeTruthy();
    expect(screen.getByText(/방장이 한 번 다시 뽑았어요/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /다시 뽑기/ })).toBeNull();
  });
});
