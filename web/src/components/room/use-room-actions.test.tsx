// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { track } from "@/lib/analytics";
import { ApiRequestError } from "@/lib/api/client";
import * as api from "@/lib/api/rooms";
import type { ParticipantInput, Room } from "@/lib/api/types";
import { createKeyTracker } from "@/lib/room/idempotency";
import type { RoomRecord } from "@/lib/room/tokens";
import { useRoomActions } from "./use-room-actions";

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/api/rooms");
vi.mock("@/lib/analytics", async (importOriginal) => ({ ...(await importOriginal<object>()), track: vi.fn() }));

const ROOM = "qt7yvmsht3";
const KEEP = "2999-01-01T00:00:00Z";
const INPUT: ParticipantInput = { nickname: "지수", originCode: "ryf", hidden: false } as ParticipantInput;
const err = (status: number, code: string) => new ApiRequestError(status, code, "서버 문구");

const host: RoomRecord = { v: 1, hostToken: "host-tok", keepUntil: KEEP };
const member: RoomRecord = { v: 1, participantToken: "tok-1", participantId: "m1", keepUntil: KEEP };
const hostAndMember: RoomRecord = { ...host, participantToken: "tok-1", participantId: "m1" };
const room = {
  roomId: ROOM,
  roomHash: "0123456789abcdef",
  createdAt: "2026-11-20T00:00:00Z",
  participants: [],
} as unknown as Room;

let log: string[];

function setup(record: RoomRecord | null | undefined) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries").mockImplementation(async (filters) => {
    log.push(`invalidate:${String(filters?.queryKey?.join("/"))}`);
  });
  const keys = createKeyTracker();
  const renew = keys.renew.bind(keys);
  vi.spyOn(keys, "renew").mockImplementation(() => {
    log.push("renew");
    renew();
  });
  const commit = vi.fn((next: RoomRecord | null) => {
    log.push(`commit:${next ? Object.keys(next).sort().join(",") : "null"}`);
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useRoomActions({ roomId: ROOM, room, record, commit, keys }), { wrapper });
  return { ...hook, commit, invalidate, keys };
}

const REFRESH = [`invalidate:room/${ROOM}`, `invalidate:room-result/${ROOM}`, `invalidate:room-preview/${ROOM}`];

beforeEach(() => {
  log = [];
  router.push.mockClear();
  window.localStorage.clear();
  vi.mocked(track).mockImplementation((name) => {
    log.push(`track:${name}`);
  });
  vi.mocked(api.newIdempotencyKey).mockImplementation(() => "key-1");
  vi.mocked(api.joinRoom).mockResolvedValue({ participantId: "m9", participantToken: "tok-9" });
  vi.mocked(api.updateParticipant).mockResolvedValue(undefined as never);
  vi.mocked(api.removeParticipant).mockResolvedValue(undefined);
  vi.mocked(api.updateRoom).mockResolvedValue({ locked: false } as Room);
  vi.mocked(api.deleteRoom).mockResolvedValue(undefined);
});

describe("useRoomActions: refresh", () => {
  it("방 → 결과 → 미리보기 순서로 무효화한다", () => {
    const { result } = setup(member);
    act(() => result.current.refresh());
    expect(log).toEqual(REFRESH);
  });
});

describe("useRoomActions: 성공 뒤처리 순서", () => {
  it("참여: 기기 기록 → 멱등 키 갱신 → 통계 → 다시 불러오기, 받은 토큰으로 기록을 만든다", async () => {
    const { result, commit } = setup(host);
    act(() => result.current.join(INPUT));
    await waitFor(() =>
      expect(log).toEqual([
        "commit:hostToken,keepUntil,participantId,participantToken,v",
        "renew",
        "track:participant_joined",
        ...REFRESH,
      ]),
    );
    expect(commit).toHaveBeenCalledWith({
      v: 1,
      hostToken: "host-tok",
      participantToken: "tok-9",
      participantId: "m9",
      keepUntil: KEEP,
    });
    expect(api.joinRoom).toHaveBeenCalledWith(ROOM, INPUT, expect.any(String));
  });

  it("참여 통계에는 기존 false 값과 방 해시를 싣고 토큰은 보내지 않는다", async () => {
    const { result } = setup(null);
    act(() => result.current.join(INPUT));
    await waitFor(() => expect(track).toHaveBeenCalled());
    const [name, props] = vi.mocked(track).mock.calls[0] ?? [];
    expect(name).toBe("participant_joined");
    expect(props).toMatchObject({ hidden: false, room_hash: "0123456789abcdef" });
    expect(JSON.stringify(props)).not.toMatch(/tok-|host-tok/);
  });

  it("수정: 폼이 닫히고 다시 불러온다", async () => {
    const { result } = setup(member);
    act(() => result.current.startEdit());
    expect(result.current.editing).toBe(true);
    act(() => result.current.edit(INPUT));
    await waitFor(() => expect(log).toEqual(REFRESH));
    await waitFor(() => expect(result.current.editing).toBe(false));
    expect(api.updateParticipant).toHaveBeenCalledWith(ROOM, "m1", "tok-1", INPUT);
  });

  it("나가기: 참여자 토큰을 뺀 기록 → 멱등 키 갱신 → 다시 불러오기, 폼이 닫힌다", async () => {
    const { result, commit } = setup(hostAndMember);
    act(() => result.current.startEdit());
    act(() => result.current.leave());
    await waitFor(() => expect(log).toEqual(["commit:hostToken,keepUntil,v", "renew", ...REFRESH]));
    expect(commit).toHaveBeenCalledWith({ v: 1, hostToken: "host-tok", keepUntil: KEEP });
    expect(result.current.editing).toBe(false);
    expect(api.removeParticipant).toHaveBeenCalledWith(ROOM, "m1", "tok-1");
  });

  it("방장이 아닌 참여자가 나가면 남길 기록이 없어 기기 기록을 비운다(commit(null))", async () => {
    const { result } = setup(member);
    act(() => result.current.leave());
    await waitFor(() => expect(log).toEqual(["commit:null", "renew", ...REFRESH]));
  });

  it("내보내기: 방장 토큰으로 지우고 다시 불러온다", async () => {
    const { result } = setup(host);
    act(() => result.current.kick("m2"));
    await waitFor(() => expect(log).toEqual(REFRESH));
    expect(api.removeParticipant).toHaveBeenCalledWith(ROOM, "m2", "host-tok");
  });

  it("잠금: 방장 토큰으로 바꾸고 다시 불러온다. 풀었는데도 잠겨 있으면 이유를 알린다", async () => {
    const { result } = setup(host);
    vi.mocked(api.updateRoom).mockResolvedValue({ locked: true } as Room);
    act(() => result.current.lock(false));
    await waitFor(() => expect(log).toEqual(REFRESH));
    expect(api.updateRoom).toHaveBeenCalledWith(ROOM, "host-tok", { locked: false });
    expect(result.current.actionError).toContain("예상 인원이 다 차서");
  });

  it("잠그는 데 성공하면 알림은 없다", async () => {
    const { result } = setup(host);
    vi.mocked(api.updateRoom).mockResolvedValue({ locked: true } as Room);
    act(() => result.current.lock(true));
    await waitFor(() => expect(log).toEqual(REFRESH));
    expect(result.current.actionError).toBeNull();
  });

  it("삭제: 기기 기록을 지우고 홈으로 가며 다시 불러오지 않는다", async () => {
    window.localStorage.setItem(`bby.room.${ROOM}`, JSON.stringify(host));
    const { result } = setup(host);
    act(() => result.current.remove());
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/"));
    expect(window.localStorage.getItem(`bby.room.${ROOM}`)).toBeNull();
    expect(log).toEqual([]);
  });
});

describe("useRoomActions: 실패", () => {
  it("나가기·내보내기·잠금·삭제 실패는 알림 칸에 올리고, 다음 동작을 시작하면 지운다", async () => {
    const { result } = setup(host);
    vi.mocked(api.removeParticipant).mockRejectedValueOnce(err(429, "RATE_LIMITED"));
    act(() => result.current.kick("m2"));
    await waitFor(() => expect(result.current.actionError).toContain("요청이 너무 많아요"));
    expect(log).toEqual([]);
    expect(result.current.busy).toBe(false);

    act(() => result.current.lock(true));
    expect(result.current.actionError).toBeNull();
  });

  it("방 없음(404)이면 알림을 올리고 다시 불러온다(알림 → 무효화)", async () => {
    const { result } = setup(host);
    vi.mocked(api.deleteRoom).mockRejectedValueOnce(err(404, "ROOM_NOT_FOUND"));
    act(() => result.current.remove());
    await waitFor(() => expect(result.current.actionError).toContain("없거나 만료된"));
    expect(log).toEqual(REFRESH);
    expect(router.push).not.toHaveBeenCalled();
  });

  it("참여 실패는 알림 칸이 아니라 joinError로 알리고, 정원·잠김처럼 방이 오래된 오류에서만 다시 불러온다", async () => {
    const { result } = setup(null);
    vi.mocked(api.joinRoom).mockRejectedValueOnce(err(409, "ROOM_FULL"));
    act(() => result.current.join(INPUT));
    await waitFor(() => expect(result.current.joinError).toContain("가득"));
    expect(result.current.actionError).toBeNull();
    expect(log).toEqual(REFRESH);
    expect(result.current.joinPending).toBe(false);

    log.length = 0;
    vi.mocked(api.joinRoom).mockRejectedValueOnce(err(429, "RATE_LIMITED"));
    act(() => result.current.join(INPUT));
    await waitFor(() => expect(result.current.joinError).toContain("너무 많아요"));
    expect(log).toEqual([]);
  });

  it("수정 실패는 editError로 알리고, 토큰이 거절되면 다시 불러오며 폼은 열려 있다. 다시 열면 오류가 지워진다", async () => {
    const { result } = setup(member);
    act(() => result.current.startEdit());
    vi.mocked(api.updateParticipant).mockRejectedValueOnce(err(401, "UNAUTHORIZED"));
    act(() => result.current.edit(INPUT));
    await waitFor(() => expect(result.current.editError).toContain("이 기기에서는 고칠 수 없어요"));
    expect(log).toEqual(REFRESH);
    expect(result.current.editing).toBe(true);
    expect(result.current.actionError).toBeNull();

    act(() => result.current.startEdit());
    await waitFor(() => expect(result.current.editError).toBeNull());
  });

  it("토큰이 없으면(참여자·방장이 아님) 요청을 보내지 않고 실패로 처리한다", async () => {
    const { result } = setup(null);
    act(() => result.current.kick("m2"));
    await waitFor(() => expect(result.current.actionError).not.toBeNull());
    expect(api.removeParticipant).not.toHaveBeenCalled();
    expect(log).toEqual([]);
  });
});
