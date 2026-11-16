// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api/rooms";
import type { Room } from "@/lib/api/types";
import { RoomResult } from "./room-result";

vi.mock("@/lib/api/rooms");

const participant = (id: string, patch: Partial<Room["participants"][number]>): Room["participants"][number] => ({
  participantId: id,
  hidden: false,
  originCode: "ryf",
  originName: "홍대입구",
  label: "홍대입구에서 오는 분",
  labelKind: "origin",
  shortLabel: "홍대입구",
  isHost: false,
  isSelf: false,
  ...patch,
});

const room: Room = {
  roomId: "qt7yvmsht3",
  mode: "favor",
  favorTarget: "p2",
  locked: false,
  expiresAt: "2999-01-01T00:00:00Z",
  dataVersion: "20261115.8",
  participants: [
    participant("p1", { isHost: true }),
    participant("p2", {
      originCode: "k3a",
      originName: "강남",
      label: "강남에서 오는 분",
      shortLabel: "강남",
    }),
    participant("p3", {
      hidden: true,
      originCode: null,
      originName: null,
      label: "참가자 3",
      labelKind: "ordinal",
      shortLabel: "참가자 3",
    }),
  ],
};

function renderResult(target: Room, onRoomGone: () => void = () => {}) {
  vi.mocked(api.getRoomResult).mockImplementation(() => new Promise(() => {}));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RoomResult
        roomId={target.roomId}
        room={target}
        participantToken={null}
        participantId={null}
        isHost={false}
        onRoomGone={onRoomGone}
        onResultSeen={() => {}}
      />
    </QueryClientProvider>,
  );
}

describe("방 결과의 배려 대상 알약", () => {
  it("짧은 이름(shortLabel)을 쓴다: 출발역이면 역 이름, 숨긴 사람은 참가자 N", () => {
    renderResult(room);
    const picker = screen.getByRole("group", { name: "누구 쪽으로 기울일까요?" });
    expect(picker).toHaveTextContent("홍대입구");
    expect(screen.getByRole("button", { name: "강남" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "참가자 3" })).toBeInTheDocument();
    expect(picker).not.toHaveTextContent("에서 오는 분");
  });

  it("shortLabel을 모르는 옛 서버면 label로 그린다", () => {
    const old = {
      ...room,
      participants: room.participants.map(({ shortLabel: _short, ...rest }) => rest),
    } as unknown as Room;
    renderResult(old);
    expect(screen.getByRole("button", { name: "강남에서 오는 분" })).toBeInTheDocument();
  });
});

describe("방 결과가 방 없음을 받으면", () => {
  it("방 화면에 알린다(방이 지워진 것이라 다시 시도는 두지 않는다)", async () => {
    const { ApiRequestError } = await import("@/lib/api/client");
    const onRoomGone = vi.fn();
    renderResult(room, onRoomGone);
    // renderResult가 걸어 둔 대기 응답을 404로 바꾼 뒤 다시 그린다.
    cleanup();
    vi.mocked(api.getRoomResult).mockRejectedValue(new ApiRequestError(404, "ROOM_NOT_FOUND", "없음"));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <RoomResult
          roomId={room.roomId}
          room={room}
          participantToken={null}
          participantId={null}
          isHost={false}
          onRoomGone={onRoomGone}
          onResultSeen={() => {}}
        />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(onRoomGone).toHaveBeenCalledTimes(1));
  });
});
