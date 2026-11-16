// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoomCreateRequest } from "@/lib/api/types";
import { CreateRoomForm } from "./create-form";

const createRoom = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/api/client", () => ({ warmUpServer: () => Promise.resolve() }));
vi.mock("@/lib/api/rooms", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/rooms")>()),
  createRoom: (...args: unknown[]) => createRoom(...args),
}));

/** 서울 11월 16일(월) 23:59. */
const BEFORE_MIDNIGHT = new Date("2026-11-16T14:59:00Z");
/** 서울 11월 17일(화) 00:01. */
const AFTER_MIDNIGHT = new Date("2026-11-16T15:01:00Z");

function renderForm() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CreateRoomForm />
    </QueryClientProvider>,
  );
}

async function pickHost(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole("combobox", { name: "내 출발역" }), "강남");
  await user.click(await screen.findByRole("option", { name: /^강남\s?2호선/ }));
}

describe("방 만들기: 화면을 연 채로 자정을 넘기면(가짜 시계)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    createRoom.mockReset();
    createRoom.mockReturnValue(new Promise(() => {}));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(BEFORE_MIDNIGHT);
  });
  afterEach(() => vi.useRealTimers());

  it("자정 뒤에 누른 '오늘'은 새 날짜이고, 그대로 보낸다", async () => {
    const user = userEvent.setup();
    renderForm();
    await pickHost(user);
    expect(screen.getByRole("radio", { name: /^오늘\s*11월 16일 \(월\)/ })).toBeInTheDocument();
    vi.setSystemTime(AFTER_MIDNIGHT);
    await user.click(screen.getByRole("radio", { name: /^오늘/ }));
    // 누르는 순간 날짜 줄도 새로 그린다.
    expect(screen.getByRole("radio", { name: /^오늘\s*11월 17일 \(화\)/ })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "방 만들기" }));
    expect(createRoom).toHaveBeenCalledTimes(1);
    const body = createRoom.mock.calls[0]?.[0] as RoomCreateRequest | undefined;
    expect(body?.meetingDate).toBe("2026-11-17");
  });

  it("자정 전에 고른 '오늘'을 자정 뒤에 제출하면 제출 시각의 오늘로 검증해 지난 날짜라고 알린다", async () => {
    const user = userEvent.setup();
    renderForm();
    await pickHost(user);
    await user.click(screen.getByRole("radio", { name: /^오늘/ }));
    vi.setSystemTime(AFTER_MIDNIGHT);
    await user.click(screen.getByRole("button", { name: "방 만들기" }));
    expect(createRoom).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("약속일은 오늘부터 30일 안에서 골라 주세요.");
    // 고른 날짜(11월 16일)는 조용히 바꾸지 않고 '고른 날짜'로 그대로 보인다.
    expect(screen.getByRole("group", { name: "날짜" })).toHaveTextContent("11월 16일월요일");
    expect(screen.getByRole("radio", { name: /^오늘\s*11월 17일 \(화\)/ })).not.toBeChecked();
  });
});
