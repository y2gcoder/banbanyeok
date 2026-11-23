// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { track } from "@/lib/analytics";
import { ApiRequestError } from "@/lib/api/client";
import * as api from "@/lib/api/rooms";
import type { RecommendResult, Room, RoomPreview } from "@/lib/api/types";
import { RoomScreen } from "./room-screen";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/api/rooms");
vi.mock("@/lib/analytics", async (importOriginal) => ({ ...(await importOriginal<object>()), track: vi.fn() }));

const ROOM = "qt7yvmsht3";
let members: { id: string; token: string }[] = [];
let tokenSeq = 0;
let basis: Room["timeBasis"];
/** 서버 공유 번호와 정한 역. undefined면 번호를 모르는 옛 서버처럼 방 응답에 싣지 않는다. */
let version: number | undefined;
let decided: Room["decision"];

function roomFor(token: string | null): Room {
  const host = {
    participantId: "h1",
    hidden: false,
    originCode: "k3a",
    originName: "강남",
    label: "민수",
    labelKind: "name" as const,
    shortLabel: "민수",
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
    ...(version === undefined ? {} : { shareVersion: version, decision: decided ?? null }),
    participants: [
      host,
      ...members.map((m) => ({
        participantId: m.id,
        hidden: true,
        originCode: m.token === token ? "ryf" : null,
        originName: m.token === token ? "홍대입구" : null,
        label: "참가자 2",
        labelKind: "ordinal" as const,
        shortLabel: "참가자 2",
        isHost: false,
        isSelf: m.token === token,
      })),
    ],
  };
}

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <RoomScreen roomId={ROOM} />
      </QueryClientProvider>,
    ),
  };
}

async function joinAsFriend(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole("heading", { name: "나도 출발역 넣기" });
  await user.type(screen.getByRole("combobox", { name: "내 출발역" }), "ㅎㄷㅇㄱ");
  await user.click(await screen.findByRole("option", { name: /^홍대입구\s?2호선/ }));
  await user.click(screen.getByRole("checkbox", { name: /출발역 이름 숨기기/ }));
  await user.click(screen.getByRole("button", { name: "참여하기" }));
}

beforeEach(() => {
  vi.mocked(track).mockClear();
  window.localStorage.clear();
  members = [];
  tokenSeq = 0;
  basis = undefined;
  version = undefined;
  decided = null;
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

  it("방을 보는 중에 방 쿼리가 404를 받으면(방장이 지움) 이전 화면을 남기지 않고 방 없음 안내로 바꾼다", async () => {
    const { ApiRequestError } = await import("@/lib/api/client");
    window.localStorage.setItem(
      `bby.room.${ROOM}`,
      JSON.stringify({ v: 1, participantToken: "tok-1", participantId: "m1", keepUntil: "2999-01-01T00:00:00Z" }),
    );
    members = [{ id: "m1", token: "tok-1" }];
    const { client } = renderScreen();
    expect(await screen.findByText("(나)")).toBeInTheDocument();
    vi.mocked(api.getRoom).mockRejectedValue(new ApiRequestError(404, "ROOM_NOT_FOUND", "없음"));
    await client.invalidateQueries({ queryKey: ["room", ROOM] });
    expect(await screen.findByRole("heading", { name: "찾을 수 없는 방이에요" })).toBeInTheDocument();
    expect(screen.queryByText("(나)")).not.toBeInTheDocument();
    await waitFor(() => expect(window.localStorage.getItem(`bby.room.${ROOM}`)).toBeNull());
  });

  it("결과 쿼리만 404를 받아도 방 전체를 방 없음 안내로 바꾸고 다시 시도는 두지 않는다", async () => {
    const { ApiRequestError } = await import("@/lib/api/client");
    window.localStorage.setItem(
      `bby.room.${ROOM}`,
      JSON.stringify({ v: 1, participantToken: "tok-1", participantId: "m1", keepUntil: "2999-01-01T00:00:00Z" }),
    );
    members = [
      { id: "m1", token: "tok-1" },
      { id: "m2", token: "tok-2" },
    ];
    vi.mocked(api.getRoomResult).mockRejectedValue(new ApiRequestError(404, "ROOM_NOT_FOUND", "없음"));
    renderScreen();
    expect(await screen.findByRole("heading", { name: "찾을 수 없는 방이에요" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "다시 시도" })).not.toBeInTheDocument();
    await waitFor(() => expect(window.localStorage.getItem(`bby.room.${ROOM}`)).toBeNull());
  });

  it("5xx 같은 다른 오류는 이전 방 화면을 그대로 둔다", async () => {
    const { ApiRequestError } = await import("@/lib/api/client");
    window.localStorage.setItem(
      `bby.room.${ROOM}`,
      JSON.stringify({ v: 1, participantToken: "tok-1", participantId: "m1", keepUntil: "2999-01-01T00:00:00Z" }),
    );
    members = [{ id: "m1", token: "tok-1" }];
    const { client } = renderScreen();
    expect(await screen.findByText("(나)")).toBeInTheDocument();
    const before = vi.mocked(api.getRoom).mock.calls.length;
    vi.mocked(api.getRoom).mockRejectedValue(new ApiRequestError(503, "UNAVAILABLE", "잠시 후"));
    await client.invalidateQueries({ queryKey: ["room", ROOM] });
    await waitFor(() => expect(vi.mocked(api.getRoom).mock.calls.length).toBeGreaterThan(before));
    await waitFor(() => expect(client.getQueryState(["room", ROOM, "m1"])?.status).toBe("error"));
    expect(screen.getByText("(나)")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "찾을 수 없는 방이에요" })).not.toBeInTheDocument();
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

  describe("인원 상한(4명) 수요 측정", () => {
    const HASH = "0123456789abcdef";
    const fullRoom = () => {
      members = [1, 2, 3].map((n) => ({ id: `m${n}`, token: `other-${n}` }));
      vi.mocked(api.getRoom).mockImplementation(async (_id, token) => ({ ...roomFor(token), roomHash: HASH }));
    };

    it("정원이 찬 방을 연 사람은 안내를 보고, people_limit_hit(room_full, room_hash)을 한 번만 보낸다", async () => {
      fullRoom();
      const { client } = renderScreen();
      expect(await screen.findByRole("heading", { name: "방이 가득 찼어요" })).toBeInTheDocument();
      expect(track).toHaveBeenCalledTimes(1);
      expect(track).toHaveBeenCalledWith("people_limit_hit", { surface: "room_full", room_hash: HASH });
      // 다시 불러와도 같은 화면에서는 더 보내지 않는다.
      await client.invalidateQueries({ queryKey: ["room", ROOM] });
      await screen.findByRole("heading", { name: "방이 가득 찼어요" });
      expect(track).toHaveBeenCalledTimes(1);
    });

    it("아직 자리가 있어 들어올 수 있는 방에서는 보내지 않는다", async () => {
      renderScreen();
      await screen.findByRole("heading", { name: "나도 출발역 넣기" });
      expect(track).not.toHaveBeenCalledWith("people_limit_hit", expect.anything());
    });

    it("방장 기기로 연 가득 찬 방은 세지 않는다", async () => {
      fullRoom();
      window.localStorage.setItem(
        `bby.room.${ROOM}`,
        JSON.stringify({ v: 1, hostToken: "host-tok", expectedCount: 4, keepUntil: "2999-01-01T00:00:00Z" }),
      );
      renderScreen();
      await screen.findByRole("heading", { name: "방이 가득 찼어요" });
      expect(track).not.toHaveBeenCalledWith("people_limit_hit", expect.anything());
    });

    it("방장이 예상 인원을 4로 정했을 뿐 자리가 남은 방(참여자 1명)에서는 세지 않는다", async () => {
      window.localStorage.setItem(
        `bby.room.${ROOM}`,
        JSON.stringify({ v: 1, hostToken: "host-tok", expectedCount: 4, keepUntil: "2999-01-01T00:00:00Z" }),
      );
      renderScreen();
      await screen.findByRole("heading", { name: "나도 출발역 넣기" });
      expect(track).not.toHaveBeenCalledWith("people_limit_hit", expect.anything());
    });

    it("이미 참여한 사람이 4명이 찬 방을 열어도 세지 않는다", async () => {
      members = [
        { id: "m1", token: "mine" },
        { id: "m2", token: "other-2" },
        { id: "m3", token: "other-3" },
      ];
      window.localStorage.setItem(
        `bby.room.${ROOM}`,
        JSON.stringify({ v: 1, participantToken: "mine", participantId: "m1", keepUntil: "2999-01-01T00:00:00Z" }),
      );
      renderScreen();
      expect(await screen.findByText("(나)")).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "방이 가득 찼어요" })).toBeNull();
      expect(track).not.toHaveBeenCalledWith("people_limit_hit", expect.anything());
    });
  });

  describe("공유 번호와 정한 역", () => {
    const WEEKDAY: NonNullable<Room["timeBasis"]> = {
      timeSlot: "weekday-day",
      requestedTimeSlot: "weekday-day",
      dayType: "weekday",
      band: "day",
      label: "평일 낮",
      holidayName: null,
    };
    /** 참이면 결과·미리보기 요청이 `release()` 전까지 끝나지 않는다(방 폴링보다 늦게 오는 응답). */
    let holdResults = false;
    let holdPreviews = false;
    let held: (() => void)[] = [];
    const release = () => {
      holdResults = false;
      holdPreviews = false;
      for (const done of held.splice(0)) done();
    };
    const later = <T,>(hold: boolean, value: () => T): Promise<T> =>
      hold ? new Promise((resolve) => held.push(() => resolve(value()))) : Promise.resolve(value());

    function resultFor(token: string | null): RecommendResult {
      const participants = roomFor(token).participants;
      const times = (seconds: number) =>
        participants.map((p) => ({ participantId: p.participantId, seconds, transfers: 0 }));
      const candidate = (rank: number, stationCode: string, stationName: string, seconds: number) => ({
        rank,
        stationCode,
        stationName,
        times: times(seconds),
        maxSeconds: seconds,
        spreadSeconds: 0,
        totalSeconds: seconds * participants.length,
        reasonCode: rank === 1 ? ("FAIR_MINIMAX" as const) : ("FAIR_ALTERNATIVE" as const),
        reason: "이유",
      });
      return {
        status: "ok",
        mode: "fair",
        dataVersion: "20261114.5",
        participants,
        timeBasis: WEEKDAY,
        candidates: [candidate(1, "s1q", "동대문역사문화공원", 1349), candidate(2, "v96", "신용산", 1388)],
        ...(version === undefined ? {} : { shareVersion: version }),
      };
    }

    function previewNow(): RoomPreview {
      const room = {
        roomId: ROOM,
        shareVersion: version ?? 0,
        participantCount: 1 + members.length,
        canJoin: true,
        meetingDate: null,
        meetingTime: null,
        meetingBand: null,
        timeBasis: WEEKDAY,
      };
      if (members.length === 0) return { stage: "collecting", room };
      const station = {
        stationCode: decided?.stationCode ?? "s1q",
        stationName: decided?.stationName ?? "동대문역사문화공원",
        times: [
          { label: "민수", seconds: 1349 },
          { label: "참가자 2", seconds: 1349 },
        ],
      };
      const base = { room, dataVersion: "20261114.5", basis: { mode: "fair" as const, favorLabel: null }, station };
      return decided
        ? { ...base, stage: "decided", decidedBy: "민수", decidedAt: decided.decidedAt }
        : { ...base, stage: "result" };
    }

    const joinedAs = (id: string, token: string) =>
      window.localStorage.setItem(
        `bby.room.${ROOM}`,
        JSON.stringify({ v: 1, participantToken: token, participantId: id, keepUntil: "2999-01-01T00:00:00Z" }),
      );

    beforeEach(() => {
      version = 3;
      holdResults = false;
      holdPreviews = false;
      held = [];
      members = [{ id: "m1", token: "tok-1" }];
      vi.mocked(api.getRoomResult).mockImplementation((_id, _query, token) =>
        later(holdResults, () => resultFor(token)),
      );
      vi.mocked(api.getRoomPreview).mockImplementation(() => later(holdPreviews, previewNow));
      vi.mocked(api.setDecision).mockImplementation(async (_id, token, body) => {
        decided = body.stationCode
          ? {
              stationCode: body.stationCode,
              stationName: "동대문역사문화공원",
              decidedBy: "m1",
              decidedAt: "2026-11-17T10:00:00Z",
            }
          : null;
        version = (version ?? 0) + 1;
        return roomFor(token);
      });
    });

    async function copiedLink(user: ReturnType<typeof userEvent.setup>): Promise<string> {
      await user.click(screen.getByRole("button", { name: /^링크(를)? 복사/ }));
      return navigator.clipboard.readText();
    }

    it("공유 칸은 하나이고, 링크에는 지금 공유 번호가, 버튼과 통계에는 지금 단계가 들어간다", async () => {
      joinedAs("m1", "tok-1");
      const user = userEvent.setup();
      const { client } = renderScreen();
      expect(await screen.findByRole("button", { name: "카톡으로 결과 보내기" })).toBeInTheDocument();
      expect(screen.getAllByRole("heading", { name: /링크/ })).toHaveLength(1);
      expect(await copiedLink(user)).toBe(`${window.location.origin}/r/${ROOM}?sv=3`);
      expect(track).toHaveBeenCalledWith("share_clicked", { channel: "copy", link_type: "room", room_stage: "result" });

      // 다른 사람이 정해서 번호가 올랐다: 방 폴링이 새 번호를 보면 미리보기를 새로 받아 링크와 버튼이 같이 바뀐다.
      decided = {
        stationCode: "s1q",
        stationName: "동대문역사문화공원",
        decidedBy: "h1",
        decidedAt: "2026-11-17T10:00:00Z",
      };
      version = 4;
      await client.invalidateQueries({ queryKey: ["room", ROOM] });
      expect(await screen.findByRole("button", { name: "카톡으로 정한 역 알리기" })).toBeInTheDocument();
      expect(await copiedLink(user)).toBe(`${window.location.origin}/r/${ROOM}?sv=4`);
      expect(api.getRoomPreview).toHaveBeenCalledTimes(2);
    });

    it("혼자인 방장은 링크 보내기 칸이 맨 위에 있고 초대 문구다", async () => {
      members = [];
      window.localStorage.setItem(
        `bby.room.${ROOM}`,
        JSON.stringify({
          v: 1,
          hostToken: "h",
          participantToken: "tok-h",
          participantId: "h1",
          keepUntil: "2999-01-01T00:00:00Z",
        }),
      );
      vi.mocked(api.getRoom).mockImplementation(async (_id, token) => {
        const room = roomFor(token);
        return { ...room, participants: room.participants.map((p) => ({ ...p, isSelf: token === "tok-h" })) };
      });
      const user = userEvent.setup();
      renderScreen();
      expect(await screen.findByRole("heading", { name: "친구에게 링크를 보내 주세요" })).toBeInTheDocument();
      await waitFor(() => expect(api.getRoomPreview).toHaveBeenCalled());
      expect(screen.getByRole("button", { name: "카톡으로 보내기" })).toBeInTheDocument();
      expect(await copiedLink(user)).toBe(`${window.location.origin}/r/${ROOM}?sv=3`);
    });

    it("번호를 모르는 옛 서버면 미리보기를 부르지 않고 번호 없는 링크와 초대 문구, 정하기는 이 화면에서만", async () => {
      version = undefined;
      joinedAs("m1", "tok-1");
      const user = userEvent.setup();
      renderScreen();
      expect(await screen.findByRole("button", { name: "카톡으로 보내기" })).toBeInTheDocument();
      expect(await copiedLink(user)).toBe(`${window.location.origin}/r/${ROOM}`);
      // 내 길찾기가 있는 카드라 예전처럼 길찾기 링크다.
      await user.click((await screen.findAllByRole("link", { name: "이 역으로 정했어요" }))[0] as HTMLElement);
      expect(api.getRoomPreview).not.toHaveBeenCalled();
      expect(api.setDecision).not.toHaveBeenCalled();
      expect(track).toHaveBeenCalledWith("station_chosen", expect.objectContaining({ rank: 1 }));
    });

    it("참여하지 않고 보는 사람에게는 정하기·풀기 버튼이 없고, 정한 역 안내는 보인다", async () => {
      decided = { stationCode: "v96", stationName: "신용산", decidedBy: "h1", decidedAt: "2026-11-17T10:00:00Z" };
      renderScreen();
      expect(await screen.findByRole("heading", { name: "신용산에서 만나요" })).toBeInTheDocument();
      expect(screen.getByText("민수가 정했어요")).toBeInTheDocument();
      expect((await screen.findAllByText("동대문역사문화공원")).length).toBeGreaterThan(0); // 결과 카드가 그려진 뒤에 본다
      expect(screen.queryByRole("button", { name: /이 역으로/ })).toBeNull();
      expect(screen.queryByRole("button", { name: "정한 역 풀기" })).toBeNull();
    });

    it("참여한 사람이 정하면 그 결과의 번호를 보내고, 정한 역 안내와 풀기가 보이며, 풀기는 방의 번호를 보낸다", async () => {
      joinedAs("m1", "tok-1");
      const user = userEvent.setup();
      renderScreen();
      await user.click((await screen.findAllByRole("button", { name: "이 역으로 정했어요" }))[0] as HTMLElement);
      expect(api.setDecision).toHaveBeenCalledWith(ROOM, "tok-1", { stationCode: "s1q", seenVersion: 3 });
      expect(await screen.findByRole("heading", { name: "동대문역사문화공원에서 만나요" })).toBeInTheDocument();
      expect(screen.getByText("내가 정했어요")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "정한 역" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "이 역으로 바꾸기" })).toBeEnabled();
      expect(track).toHaveBeenCalledWith("station_chosen", {
        rank: 1,
        meeting_station_code: "s1q",
        mode: "fair",
        participant_count: 2,
        link_variant: "received",
      });

      await user.click(screen.getByRole("button", { name: "정한 역 풀기" }));
      expect(api.setDecision).toHaveBeenLastCalledWith(ROOM, "tok-1", { stationCode: null, seenVersion: 4 });
      await waitFor(() => expect(screen.queryByRole("heading", { name: /에서 만나요$/ })).toBeNull());
    });

    it("정한 직후 결과가 아직 옛 번호면 바꾸기를 막고 불러오는 중이라고 알린 뒤, 새 결과가 오면 그 번호로 보낸다", async () => {
      joinedAs("m1", "tok-1");
      const user = userEvent.setup();
      renderScreen();
      const first = (await screen.findAllByRole("button", { name: "이 역으로 정했어요" }))[0] as HTMLElement;
      holdResults = true;
      await user.click(first);
      expect(await screen.findByRole("heading", { name: "동대문역사문화공원에서 만나요" })).toBeInTheDocument();
      const change = screen.getByRole("button", { name: "이 역으로 바꾸기" });
      expect(change).toBeDisabled();
      expect(screen.getByText("새 결과 불러오는 중")).toBeInTheDocument();
      await user.click(change);
      expect(api.setDecision).toHaveBeenCalledTimes(1);

      release();
      await waitFor(() => expect(screen.getByRole("button", { name: "이 역으로 바꾸기" })).toBeEnabled());
      await user.click(screen.getByRole("button", { name: "이 역으로 바꾸기" }));
      expect(api.setDecision).toHaveBeenLastCalledWith(ROOM, "tok-1", { stationCode: "v96", seenVersion: 4 });
    });

    it("방 폴링이 먼저 새 번호를 보면 결과를 바로 다시 불러오고, 그 결과의 번호로 정한다", async () => {
      joinedAs("m1", "tok-1");
      const user = userEvent.setup();
      const { client } = renderScreen();
      await screen.findAllByRole("button", { name: "이 역으로 정했어요" });
      version = 4; // 누가 이름을 바꿨다(정함과 무관해 서버는 번호 4로 정하는 것을 받는다)
      await client.invalidateQueries({ queryKey: ["room", ROOM] });
      await waitFor(() => expect(api.getRoomResult).toHaveBeenCalledTimes(2));
      await waitFor(() =>
        expect(screen.getAllByRole("button", { name: "이 역으로 정했어요" })[0] as HTMLElement).toBeEnabled(),
      );
      await user.click(screen.getAllByRole("button", { name: "이 역으로 정했어요" })[0] as HTMLElement);
      expect(api.setDecision).toHaveBeenCalledWith(ROOM, "tok-1", { stationCode: "s1q", seenVersion: 4 });
    });

    it("결과가 먼저 새 번호(다른 사람이 정함)를 보면 방을 다시 불러와 그 정함을 보여 준 뒤에야 바꾸게 한다", async () => {
      joinedAs("m1", "tok-1");
      const user = userEvent.setup();
      const { client } = renderScreen();
      await screen.findAllByRole("button", { name: "이 역으로 정했어요" });
      decided = {
        stationCode: "s1q",
        stationName: "동대문역사문화공원",
        decidedBy: "h1",
        decidedAt: "2026-11-17T10:00:00Z",
      };
      version = 4;
      await client.invalidateQueries({ queryKey: ["room-result", ROOM] }); // 방은 아직 번호 3
      expect(await screen.findByRole("heading", { name: "동대문역사문화공원에서 만나요" })).toBeInTheDocument();
      const change = await screen.findByRole("button", { name: "이 역으로 바꾸기" });
      await waitFor(() => expect(change).toBeEnabled());
      await user.click(change);
      expect(api.setDecision).toHaveBeenCalledWith(ROOM, "tok-1", { stationCode: "v96", seenVersion: 4 });
    });

    it("방이 새 번호로 바뀌고 그 미리보기를 받는 동안은 옛 번호·옛 단계 대신 번호 없는 링크와 초대 문구를 준다", async () => {
      joinedAs("m1", "tok-1");
      const user = userEvent.setup();
      const { client } = renderScreen();
      expect(await screen.findByRole("button", { name: "카톡으로 결과 보내기" })).toBeInTheDocument();
      expect(await copiedLink(user)).toBe(`${window.location.origin}/r/${ROOM}?sv=3`);

      holdPreviews = true;
      decided = {
        stationCode: "s1q",
        stationName: "동대문역사문화공원",
        decidedBy: "h1",
        decidedAt: "2026-11-17T10:00:00Z",
      };
      version = 4;
      await client.invalidateQueries({ queryKey: ["room", ROOM] });
      expect(await screen.findByRole("heading", { name: "동대문역사문화공원에서 만나요" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "카톡으로 보내기" })).toBeInTheDocument();
      expect(await copiedLink(user)).toBe(`${window.location.origin}/r/${ROOM}`);

      release();
      expect(await screen.findByRole("button", { name: "카톡으로 정한 역 알리기" })).toBeInTheDocument();
      expect(await copiedLink(user)).toBe(`${window.location.origin}/r/${ROOM}?sv=4`);
    });

    it("그사이 방이 바뀌어 거절되면(409 ROOM_CHANGED) 방·결과·미리보기를 다시 불러오고 다시 고르게 안내한다", async () => {
      joinedAs("m1", "tok-1");
      vi.mocked(api.setDecision).mockRejectedValue(new ApiRequestError(409, "ROOM_CHANGED", "바뀜"));
      const user = userEvent.setup();
      renderScreen();
      const buttons = await screen.findAllByRole("button", { name: "이 역으로 정했어요" });
      await waitFor(() => expect(api.getRoomPreview).toHaveBeenCalled());
      const before = {
        room: vi.mocked(api.getRoom).mock.calls.length,
        result: vi.mocked(api.getRoomResult).mock.calls.length,
        preview: vi.mocked(api.getRoomPreview).mock.calls.length,
      };
      await user.click(buttons[0] as HTMLElement);
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "그사이 방이 바뀌었어요. 새로 불러왔으니 다시 골라 주세요.",
      );
      await waitFor(() => {
        expect(vi.mocked(api.getRoom).mock.calls.length).toBeGreaterThan(before.room);
        expect(vi.mocked(api.getRoomResult).mock.calls.length).toBeGreaterThan(before.result);
        expect(vi.mocked(api.getRoomPreview).mock.calls.length).toBeGreaterThan(before.preview);
      });
      expect(track).not.toHaveBeenCalledWith("station_chosen", expect.anything());
    });
  });
});
