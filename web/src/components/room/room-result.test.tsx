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
      originCode: "s1q",
      originName: "동대문역사문화공원",
      label: "동대문역사문화공원에서 오는 분",
      shortLabel: "동대문역사문화공원",
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
        decision={{ kind: "viewer" }}
        onRoomGone={onRoomGone}
        onResultSeen={() => {}}
      />
    </QueryClientProvider>,
  );
}

describe("방 결과의 배려 대상 알약", () => {
  it("짧은 이름(shortLabel)을 쓴다: 출발역이면 역 이름", () => {
    renderResult(room);
    const picker = screen.getByRole("group", { name: "누구 쪽으로 기울일까요?" });
    expect(picker).toHaveTextContent("홍대입구");
    expect(screen.getByRole("button", { name: "강남" })).toHaveAttribute("aria-pressed", "true");
    expect(picker).not.toHaveTextContent("에서 오는 분");
  });

  it("참여자 모두를 고를 수 있다", () => {
    renderResult(room);
    expect(screen.getByRole("button", { name: "동대문역사문화공원" })).toBeInTheDocument();
  });

  it("기본 배려 대상이 방을 나갔다면 첫 참가자를 고른다", () => {
    renderResult({ ...room, favorTarget: "gone" });
    expect(screen.getByRole("tab", { name: "누구 쪽으로" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "홍대입구" })).toHaveAttribute("aria-pressed", "true");
    expect(vi.mocked(api.getRoomResult)).toHaveBeenLastCalledWith(
      room.roomId,
      { mode: "favor", favor: "p1" },
      null,
      expect.anything(),
    );
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

describe("방의 약속을 바꾸는 동안의 막차 칸(#83 재검토)", () => {
  type Result = Awaited<ReturnType<typeof api.getRoomResult>>;

  // 강남(지연)·부천. 1위 신도림의 강남 방면 직행 막차: 금요일 운행일 24:27(1467분), 토요일 운행일 23:27(1407분).
  const people = [
    participant("p1", {
      isHost: true,
      originCode: "k3a",
      originName: "강남",
      nickname: "지연",
      label: "지연",
      labelKind: "name",
      shortLabel: "지연",
    }),
    participant("p2", {
      originCode: "6dk",
      originName: "부천",
      label: "부천에서 오는 분",
      shortLabel: "부천",
    }),
  ];
  const meetingRoom = (shareVersion: number, meetingDate: string, meetingTime: string): Room => ({
    ...room,
    mode: "fair",
    favorTarget: null,
    participants: people,
    shareVersion,
    roomHash: "0123456789abcdef",
    decision: null,
    meetingDate,
    meetingTime,
  });
  const friday = meetingRoom(4, "2026-11-27", "19:30");
  const saturday = meetingRoom(5, "2026-11-28", "23:30");

  const resultOf = (shareVersion: number, dayType: "weekday" | "saturday", minute: number): Result =>
    ({
      status: "ok",
      mode: "fair",
      dataVersion: "20261120.4",
      shareVersion,
      participants: people,
      timeBasis: {
        timeSlot: `${dayType}-night`,
        requestedTimeSlot: `${dayType}-night`,
        dayType,
        band: "night",
        label: dayType === "weekday" ? "평일 밤" : "토요일 밤",
        holidayName: null,
      },
      lastTrainBasis: { dayType, asOf: "2026-11-16", partial: true },
      candidates: [
        {
          rank: 1,
          stationCode: "sdr",
          stationName: "신도림",
          times: [
            { participantId: "p1", seconds: 1500, transfers: 0 },
            { participantId: "p2", seconds: 1320, transfers: 0 },
          ],
          maxSeconds: 1500,
          spreadSeconds: 180,
          totalSeconds: 2820,
          reasonCode: "FAIR_MINIMAX",
          reason: "가장 오래 걸리는 지연도 25분이에요.",
          lastTrains: [
            {
              participantId: "p1",
              kind: "direct",
              minute,
              boundFor: { stationCode: "9k5", stationName: "삼성" },
            },
          ],
        },
      ],
    }) as Result;

  function mount(first: Room) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = (target: Room) => (
      <QueryClientProvider client={client}>
        <RoomResult
          roomId={target.roomId}
          room={target}
          participantToken={null}
          participantId={null}
          isHost={false}
          decision={{ kind: "viewer" }}
          onRoomGone={() => {}}
          onResultSeen={() => {}}
        />
      </QueryClientProvider>
    );
    const view = render(tree(first));
    return { show: (target: Room) => view.rerender(tree(target)) };
  }

  // 1위 카드의 막차 칸은 "자세히" 안에 있다(#122). 내용 규칙을 보므로 접힌 채로 찾는다(접힌 요약 줄은 candidate-card 테스트가 본다).
  const section = () => screen.getByRole("region", { name: "신도림역 집에 가는 막차", hidden: true });
  const RECALCULATING = "방 내용이 바뀌어 막차 다시 계산 중";

  it("방이 먼저 바뀌면: 새 결과가 올 때까지 새 약속 아래에 이전 운행일의 막차를 보이지 않는다", async () => {
    let deliver: (result: Result) => void = () => {};
    vi.mocked(api.getRoomResult)
      .mockReset()
      .mockResolvedValueOnce(resultOf(4, "weekday", 1467))
      .mockImplementationOnce(() => new Promise<Result>((resolve) => (deliver = resolve)));
    const { show } = mount(friday);
    // 금요일 19:30 약속: 금요일 운행일의 24:27은 다음 날 00:27이다.
    await waitFor(() => expect(section()).toHaveTextContent("공개된 시각 중 가장 이름: 지연 다음 날 00:27"));
    expect(section()).toHaveTextContent("평일 시간표");

    // 방장이 약속을 토요일 23:30으로 바꿨다. 방이 먼저 도착하고 결과는 아직 금요일 것이다.
    show(saturday);
    expect(section()).toHaveTextContent(`집에 가는 막차${RECALCULATING}`);
    expect(section()).not.toHaveTextContent(/00:27|다음 날|가장 이름|전 출발|평일 시간표|삼성행/);
    // 번호가 달라 결과를 다시 받는다.
    await waitFor(() => expect(api.getRoomResult).toHaveBeenCalledTimes(2));
    expect(section()).not.toHaveTextContent(/00:27|다음 날/);

    // 새 결과(토요일 운행일 23:27)가 오면 새 약속과 함께 그린다: 약속 3분 전에 떠나는 열차다.
    deliver(resultOf(5, "saturday", 1407));
    await waitFor(() => expect(section()).toHaveTextContent("11월 28일 23:27 막차는 약속 전에 떠나요."));
    expect(section()).toHaveTextContent("약속 전에 막차가 떠나는 분이 있어요.");
    expect(section()).not.toHaveTextContent(RECALCULATING);
    expect(section()).not.toHaveTextContent(/00:27|다음 날/);
  });

  it("새 결과가 먼저 와도: 방이 새 약속으로 바뀔 때까지 이전 약속과 섞어 그리지 않는다", async () => {
    vi.mocked(api.getRoomResult)
      .mockReset()
      .mockResolvedValue(resultOf(5, "saturday", 1407));
    const { show } = mount(friday);
    // 화면의 방은 아직 금요일 19:30(번호 4)인데 결과는 토요일 것(번호 5)이다. 금요일 약속 기준이면 "막차 23:27"로 보였을 값이다.
    await waitFor(() => expect(section()).toHaveTextContent(RECALCULATING));
    expect(section()).not.toHaveTextContent(/23:27|가장 이름|전 출발|토요일 시간표/);
    show(saturday);
    await waitFor(() => expect(section()).toHaveTextContent("11월 28일 23:27 막차는 약속 전에 떠나요."));
    expect(section()).not.toHaveTextContent(RECALCULATING);
  });

  it("공유 번호를 보내지 않는 옛 서버(둘 다 없음)는 받은 결과를 그대로 그린다", async () => {
    const { shareVersion: _room, ...oldRoom } = friday;
    const { shareVersion: _result, ...oldResult } = resultOf(4, "weekday", 1467);
    vi.mocked(api.getRoomResult)
      .mockReset()
      .mockResolvedValue(oldResult as Result);
    mount(oldRoom as Room);
    await waitFor(() => expect(section()).toHaveTextContent("막차00:27다음 날· 삼성행"));
  });
});
