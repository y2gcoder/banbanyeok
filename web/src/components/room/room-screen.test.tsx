// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api/rooms";
import type { Room } from "@/lib/api/types";
import { RoomScreen } from "./room-screen";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/api/rooms");

const ROOM = "qt7yvmsht3";
let members: { id: string; token: string }[] = [];
let tokenSeq = 0;
let basis: Room["timeBasis"];

function roomFor(token: string | null): Room {
  const host = {
    participantId: "h1",
    hidden: false,
    originCode: "k3a",
    originName: "강남",
    label: "민수",
    labelKind: "name" as const,
    isHost: true,
    isSelf: false,
  };
  return {
    roomId: ROOM,
    mode: "fair",
    locked: false,
    expiresAt: "2999-01-01T00:00:00Z",
    dataVersion: "20261114.5",
    ...(basis ? { timeBasis: basis } : {}),
    participants: [
      host,
      ...members.map((m) => ({
        participantId: m.id,
        hidden: true,
        originCode: m.token === token ? "ryf" : null,
        originName: m.token === token ? "홍대입구" : null,
        label: "참가자 2",
        labelKind: "ordinal" as const,
        isHost: false,
        isSelf: m.token === token,
      })),
    ],
  };
}

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RoomScreen roomId={ROOM} />
    </QueryClientProvider>,
  );
}

async function joinAsFriend(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole("heading", { name: "나도 출발역 넣기" });
  await user.type(screen.getByRole("combobox", { name: "내 출발역" }), "ㅎㄷㅇㄱ");
  await user.click(await screen.findByRole("option", { name: /^홍대입구\s?2호선/ }));
  await user.click(screen.getByRole("checkbox", { name: /출발역 이름 숨기기/ }));
  await user.click(screen.getByRole("button", { name: "참여하기" }));
}

beforeEach(() => {
  window.localStorage.clear();
  members = [];
  tokenSeq = 0;
  basis = undefined;
  vi.mocked(api.getRoom).mockImplementation(async (_id, token) => roomFor(token));
  vi.mocked(api.getRoomResult).mockImplementation(() => new Promise(() => {}));
  vi.mocked(api.newIdempotencyKey).mockImplementation(() => `key-${++tokenSeq}`);
  vi.mocked(api.joinRoom).mockImplementation(async () => {
    tokenSeq += 1;
    const member = { id: `m${tokenSeq}`, token: `tok-${tokenSeq}` };
    members.push(member);
    return { participantId: member.id, participantToken: member.token };
  });
  vi.mocked(api.removeParticipant).mockImplementation(async (_room, id) => {
    members = members.filter((m) => m.id !== id);
  });
});

describe("방 화면", () => {
  it("참여 화면에도 서버가 준 계산 기준 문구를 그대로 보여 준다(웹이 날짜로 다시 계산하지 않는다)", async () => {
    // 약속일이 평범한 토요일이어도 서버가 공휴일로 정했으면 서버 문구가 이긴다.
    basis = {
      timeSlot: "holiday-evening",
      requestedTimeSlot: "holiday-evening",
      dayType: "holiday",
      band: "evening",
      label: "일요일·공휴일 저녁",
      holidayName: "추석",
    };
    renderScreen();
    await screen.findByRole("heading", { name: "나도 출발역 넣기" });
    expect(screen.getByText("일요일·공휴일 저녁(추석) 기준으로 계산해요")).toBeInTheDocument();
  });

  it("서버가 계산 기준을 주지 않으면(옛 서버) 문구를 그리지 않는다", async () => {
    renderScreen();
    await screen.findByRole("heading", { name: "나도 출발역 넣기" });
    expect(screen.queryByText(/기준으로 계산해요/)).toBeNull();
  });

  it("저장소가 막힌 기기에서도 참여가 성공하면 이번 방문 동안은 내 항목으로 보이고, 다시 제출할 수 없다(중복 참가자 방지)", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    const user = userEvent.setup();
    renderScreen();
    await joinAsFriend(user);
    expect(await screen.findByText("(나)")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "나도 출발역 넣기" })).not.toBeInTheDocument();
    expect(api.joinRoom).toHaveBeenCalledTimes(1);
    expect(members).toHaveLength(1);
  });

  it("나갔다가 같은 입력으로 다시 참여하면 새 멱등 키를 쓴다(서버가 지난 성공 응답을 재생하지 않게)", async () => {
    const user = userEvent.setup();
    renderScreen();
    await joinAsFriend(user);
    await screen.findByText("(나)");
    const firstKey = vi.mocked(api.joinRoom).mock.calls[0]?.[2];

    await user.click(screen.getByRole("button", { name: "삭제 내 항목" }));
    await user.click(screen.getByRole("button", { name: "지우기" }));
    await screen.findByRole("heading", { name: "나도 출발역 넣기" });
    await waitFor(() => expect(screen.queryByText("(나)")).not.toBeInTheDocument());

    await joinAsFriend(user);
    await screen.findByText("(나)");
    const secondKey = vi.mocked(api.joinRoom).mock.calls[1]?.[2];
    expect(firstKey).toBeTruthy();
    expect(secondKey).toBeTruthy();
    expect(secondKey).not.toBe(firstKey);
  });

  it("서버가 방 없음(404)이라고 하면 방 없음 안내를 보이고 이 기기의 토큰을 지운다", async () => {
    window.localStorage.setItem(
      `bby.room.${ROOM}`,
      JSON.stringify({ v: 1, participantToken: "old", participantId: "x", keepUntil: "2999-01-01T00:00:00Z" }),
    );
    const { ApiRequestError } = await import("@/lib/api/client");
    vi.mocked(api.getRoom).mockRejectedValue(new ApiRequestError(404, "ROOM_NOT_FOUND", "없음"));
    renderScreen();
    expect(await screen.findByRole("heading", { name: "찾을 수 없는 방이에요" })).toBeInTheDocument();
    await waitFor(() => expect(window.localStorage.getItem(`bby.room.${ROOM}`)).toBeNull());
  });

  it("살아 있는 방은 저장해 둔 지 오래돼도(서버는 활동마다 만료를 미룬다) 열 때 토큰을 지우지 않는다", async () => {
    window.localStorage.setItem(
      `bby.room.${ROOM}`,
      JSON.stringify({
        v: 1,
        hostToken: "host-tok",
        participantToken: "tok-1",
        participantId: "m1",
        keepUntil: "2999-01-01T00:00:00Z",
      }),
    );
    members = [{ id: "m1", token: "tok-1" }];
    renderScreen();
    expect(await screen.findByText("(나)")).toBeInTheDocument();
    expect(window.localStorage.getItem(`bby.room.${ROOM}`)).toContain("host-tok");
  });
});
