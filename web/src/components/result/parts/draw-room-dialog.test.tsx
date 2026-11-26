// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoomCreated } from "@/lib/api/types";
import type { ShareState } from "@/lib/link/codec";
import { loadRoomRecord } from "@/lib/room/tokens";
import { DrawRoomDialog } from "./draw-room-dialog";

const createRoom = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/api/rooms", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/rooms")>()),
  createRoom: (...args: unknown[]) => createRoom(...args),
}));

/** 서울 11월 26일(목) 낮. */
const THURSDAY = new Date("2026-11-26T03:00:00Z");

const STATE: ShareState = {
  origins: ["k3a", "ryf", "dxy"],
  mode: "fair",
  favorIndex: null,
  nicknames: ["민수", null, "하늘"],
  timeSlot: "saturday-evening",
};
const PEOPLE = [
  { index: 0, name: "민수" },
  { index: 1, name: "홍대입구" },
  { index: 2, name: "하늘" },
];
const CREATED: RoomCreated = {
  roomId: "abcd1234",
  hostToken: "host-token",
  participantId: "pid-host",
  participantToken: "participant-token",
  expiresAt: "2026-11-29T15:00:00Z",
};

function renderDialog(onOpenChange = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DrawRoomDialog open onOpenChange={onOpenChange} state={STATE} people={PEOPLE} />
    </QueryClientProvider>,
  );
  return onOpenChange;
}

describe("사다리 방 확인 대화상자", () => {
  beforeEach(() => {
    window.localStorage.clear();
    createRoom.mockReset();
    push.mockReset();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(THURSDAY);
  });
  afterEach(() => vi.useRealTimers());

  it("사람을 뽑는다는 것과 저장·공개·보관 규칙을 방을 만들기 전에 알린다", () => {
    renderDialog();
    const dialog = screen.getByRole("dialog", { name: "사다리로 누구 쪽일지 뽑을까요?" });
    expect(dialog).toHaveTextContent("사다리는 역이 아니라 사람을 뽑아요.");
    expect(dialog).toHaveTextContent("넣은 3명의 이름(넣은 경우)과 출발역, 약속 요일·시간대가 방에 저장돼요.");
    expect(dialog).toHaveTextContent("약속일(11월 28일 (토)) 다음 날 방이 사라져요.");
    expect(dialog).toHaveTextContent(
      "방 링크를 가진 사람은 누구나 이름, 출발역, 각자 걸리는 시간과 사다리 결과를 볼 수 있어요.",
    );
    expect(dialog).toHaveTextContent("다른 사람이 더 들어오지 않게 방을 잠가 둬요.");
    expect(createRoom).not.toHaveBeenCalled();
  });

  it("고른 '나'를 방장으로, 나머지를 입력 순서대로 보내고, 방장 기록을 남긴 뒤 방으로 간다", async () => {
    createRoom.mockResolvedValue(CREATED);
    const user = userEvent.setup();
    renderDialog();
    const me = screen.getByRole("group", { name: "이 중 나는?" });
    expect(within(me).getByRole("radio", { name: "민수" })).toBeChecked();
    await user.click(within(me).getByRole("radio", { name: "하늘" }));
    await user.click(screen.getByRole("button", { name: "방 만들고 사다리 타러 가기" }));

    expect(createRoom).toHaveBeenCalledTimes(1);
    expect(createRoom.mock.calls[0]?.[0]).toEqual({
      mode: "favor",
      favorTarget: "draw",
      host: { nickname: "하늘", originCode: "dxy", hidden: false },
      others: [
        { nickname: "민수", originCode: "k3a", hidden: false },
        { originCode: "ryf", hidden: false },
      ],
      hostPosition: 2,
      meetingDate: "2026-11-28",
      meetingBand: "evening",
    });
    expect(push).toHaveBeenCalledWith("/r/abcd1234");
    expect(loadRoomRecord("abcd1234")?.hostToken).toBe("host-token");
  });

  it("실패하면 방으로 가지 않고, 같은 내용으로 다시 누르면 같은 Idempotency-Key로 보낸다", async () => {
    createRoom.mockRejectedValueOnce(new Error("network"));
    createRoom.mockResolvedValueOnce(CREATED);
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole("button", { name: "방 만들고 사다리 타러 가기" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "방 만들고 사다리 타러 가기" }));
    expect(createRoom).toHaveBeenCalledTimes(2);
    expect(createRoom.mock.calls[1]?.[1]).toBe(createRoom.mock.calls[0]?.[1]);
    expect(push).toHaveBeenCalledWith("/r/abcd1234");
  });

  it("취소하면 아무것도 만들지 않고 닫는다", async () => {
    const user = userEvent.setup();
    const onOpenChange = renderDialog();
    await user.click(screen.getByRole("button", { name: "취소" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(createRoom).not.toHaveBeenCalled();
  });
});
