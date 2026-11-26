// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/lib/api/client";
import type { Room, RoomCreated } from "@/lib/api/types";
import type { ShareState } from "@/lib/link/codec";
import { loadRoomRecord, ROOM_KEY_PREFIX } from "@/lib/room/tokens";
import { DrawRoomDialog } from "./draw-room-dialog";

const createRoom = vi.fn();
const getRoom = vi.fn();
const deleteRoom = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/api/rooms", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/rooms")>()),
  createRoom: (...args: unknown[]) => createRoom(...args),
  getRoom: (...args: unknown[]) => getRoom(...args),
  deleteRoom: (...args: unknown[]) => deleteRoom(...args),
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

/** 서버가 저장한 방(필요한 필드만). 새 서버는 대신 넣은 두 칸을 표시해 잠근다. */
const storedRoom = (locked: boolean, entered: number) =>
  ({
    locked,
    participants: [0, 1, 2].map((i) => ({ participantId: `p${i}`, enteredByHost: i < entered })),
  }) as unknown as Room;

/** 짧은 검사 값은 저장되지만 실제 방 기록은 저장 공간이 모자라 실패하는 브라우저. 끄는 함수를 돌려준다. */
function quotaOnRoomRecords() {
  const original = Storage.prototype.setItem;
  const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
    if (key.startsWith(ROOM_KEY_PREFIX) && key !== `${ROOM_KEY_PREFIX}probe`) {
      throw new DOMException("quota", "QuotaExceededError");
    }
    original.call(this, key, value);
  });
  return () => spy.mockRestore();
}

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
    getRoom.mockReset();
    deleteRoom.mockReset();
    getRoom.mockResolvedValue(storedRoom(true, 2));
    deleteRoom.mockResolvedValue(undefined);
    push.mockReset();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(THURSDAY);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

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

  describe("방장 권한을 이 기기에 저장하지 못하면(검사는 통과, 실제 기록에서 QuotaExceededError)", () => {
    it("방으로 가지 않고, 닫거나 새 방을 만들지 못하게 한 채 받은 토큰으로 다시 저장할 수 있다", async () => {
      createRoom.mockResolvedValue(CREATED);
      const restore = quotaOnRoomRecords();
      const user = userEvent.setup();
      const onOpenChange = renderDialog();
      await user.click(screen.getByRole("button", { name: "방 만들고 사다리 타러 가기" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("이 브라우저에 방장 권한을 저장하지 못했어요");
      expect(push).not.toHaveBeenCalled();
      expect(loadRoomRecord("abcd1234")).toBeNull();
      expect(screen.queryByRole("button", { name: "방 만들고 사다리 타러 가기" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "취소" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "닫기" })).not.toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "하늘" })).toBeDisabled();
      await user.keyboard("{Escape}");
      expect(onOpenChange).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: "다시 저장하고 사다리 타러 가기" }));
      expect(screen.getByRole("alert")).toHaveTextContent("아직 저장하지 못했어요.");
      expect(push).not.toHaveBeenCalled();

      restore();
      await user.click(screen.getByRole("button", { name: "다시 저장하고 사다리 타러 가기" }));
      expect(loadRoomRecord("abcd1234")?.hostToken).toBe("host-token");
      expect(push).toHaveBeenCalledWith("/r/abcd1234");
      expect(createRoom).toHaveBeenCalledTimes(1);
      expect(deleteRoom).not.toHaveBeenCalled();
    });

    it("만든 방을 받은 방장 토큰으로 지울 수 있고, 지운 뒤 다시 만들면 새 Idempotency-Key로 보낸다", async () => {
      createRoom.mockResolvedValue(CREATED);
      quotaOnRoomRecords();
      const user = userEvent.setup();
      const onOpenChange = renderDialog();
      await user.click(screen.getByRole("button", { name: "방 만들고 사다리 타러 가기" }));
      await user.click(await screen.findByRole("button", { name: "만든 방 지우기" }));

      expect(deleteRoom).toHaveBeenCalledWith("abcd1234", "host-token");
      expect(
        await screen.findByText("만든 방을 지웠어요. 저장 공간을 비운 뒤 다시 만들 수 있어요."),
      ).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(push).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "닫기" })).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "취소" }));
      expect(onOpenChange).toHaveBeenCalledWith(false);

      await user.click(screen.getByRole("button", { name: "방 만들고 사다리 타러 가기" }));
      expect(createRoom).toHaveBeenCalledTimes(2);
      expect(createRoom.mock.calls[1]?.[1]).not.toBe(createRoom.mock.calls[0]?.[1]);
    });

    it("지우기가 실패하면 토큰을 들고 그대로 머물러 다시 지우거나 저장할 수 있다(이미 없는 방이면 지운 것으로 본다)", async () => {
      createRoom.mockResolvedValue(CREATED);
      quotaOnRoomRecords();
      deleteRoom.mockRejectedValueOnce(new Error("network"));
      deleteRoom.mockRejectedValueOnce(new ApiRequestError(404, "ROOM_NOT_FOUND", "없음"));
      const user = userEvent.setup();
      renderDialog();
      await user.click(screen.getByRole("button", { name: "방 만들고 사다리 타러 가기" }));
      await user.click(await screen.findByRole("button", { name: "만든 방 지우기" }));

      expect(await screen.findByText(/방을 지우지 못했어요\./)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "다시 저장하고 사다리 타러 가기" })).toBeEnabled();
      await user.click(screen.getByRole("button", { name: "만든 방 지우기" }));
      expect(deleteRoom).toHaveBeenCalledTimes(2);
      expect(deleteRoom.mock.calls[1]).toEqual(["abcd1234", "host-token"]);
      expect(await screen.findByText(/만든 방을 지웠어요/)).toBeInTheDocument();
      expect(push).not.toHaveBeenCalled();
    });
  });

  it("대신 넣은 칸을 모르는 옛 서버가 방장만 있는 열린 방을 만들면, 그 방을 지우고 방으로 가지 않는다", async () => {
    createRoom.mockResolvedValue(CREATED);
    getRoom.mockResolvedValue(storedRoom(false, 0));
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole("button", { name: "방 만들고 사다리 타러 가기" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "지금은 사다리 방을 만들 수 없어요. 만들던 방은 지웠어요.",
    );
    expect(getRoom).toHaveBeenCalledWith("abcd1234", "participant-token");
    expect(deleteRoom).toHaveBeenCalledWith("abcd1234", "host-token");
    expect(push).not.toHaveBeenCalled();
    expect(loadRoomRecord("abcd1234")).toBeNull();
  });
});
