// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
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

/** 결과 응답은 기본이 대기(결과 없음). 오류를 주려면 `reject`에 넣는다. */
function renderResult(target: Room, onRoomGone: () => void = () => {}, reject?: Error) {
  vi.mocked(api.getRoomResult).mockImplementation(() => (reject ? Promise.reject(reject) : new Promise(() => {})));
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
  it("방 화면에 알리고, 되살릴 수 없으므로 오류 카드와 다시 시도는 그리지 않는다", async () => {
    const { ApiRequestError } = await import("@/lib/api/client");
    const onRoomGone = vi.fn();
    renderResult(room, onRoomGone, new ApiRequestError(404, "ROOM_NOT_FOUND", "없음"));
    await waitFor(() => expect(onRoomGone).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "다시 시도" })).not.toBeInTheDocument();
  });

  it("방이 아닌 다른 404(참여자 없음)는 알리지 않고 오류 카드와 다시 시도를 보인다", async () => {
    const { ApiRequestError } = await import("@/lib/api/client");
    const onRoomGone = vi.fn();
    renderResult(room, onRoomGone, new ApiRequestError(404, "PARTICIPANT_NOT_FOUND", "없음"));
    expect(await screen.findByRole("button", { name: "다시 시도" })).toBeInTheDocument();
    expect(onRoomGone).not.toHaveBeenCalled();
  });
});
