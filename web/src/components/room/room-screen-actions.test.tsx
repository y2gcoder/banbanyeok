// @vitest-environment jsdom
/**
 * 방 화면의 쓰기 동작 6개(참여·수정·나가기·내보내기·잠금·삭제)가 오류를 어떻게 다루는지(문구를 어디에 보이나, 다시 불러오나)와
 * 성공했을 때 부수 효과 순서(기기 기록 → 통계 → 캐시 무효화)를 화면 단위로 고정한다. 구현이 어디에 있든(화면 안, 훅) 같아야 하는 동작이다.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { track } from "@/lib/analytics";
import { ApiRequestError } from "@/lib/api/client";
import * as api from "@/lib/api/rooms";
import type { Room } from "@/lib/api/types";
import { roomErrorMessage } from "@/lib/room/errors";
import { RoomScreen } from "./room-screen";

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/api/rooms");
vi.mock("@/lib/analytics", async (importOriginal) => ({ ...(await importOriginal<object>()), track: vi.fn() }));

const ROOM = "qt7yvmsht3";
const STORAGE_KEY = `bby.room.${ROOM}`;
const KEEP = "2999-01-01T00:00:00Z";

type Role = "host" | "member" | "visitor";
let members: { id: string; token: string }[] = [];
let locked = false;
let log: string[] = [];

function roomFor(token: string | null): Room {
  return {
    roomId: ROOM,
    mode: "fair",
    locked,
    expiresAt: "2999-01-01T00:00:00Z",
    dataVersion: "20261114.5",
    participants: [
      {
        participantId: "h1",
        hidden: false,
        originCode: "k3a",
        originName: "강남",
        label: "민수",
        labelKind: "name" as const,
        shortLabel: "민수",
        isHost: true,
        isSelf: false,
      },
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

function seed(role: Role) {
  members = role === "visitor" ? [] : [{ id: "m1", token: "tok-1" }];
  if (role === "visitor") return;
  const record =
    role === "host"
      ? { v: 1, hostToken: "host-tok", keepUntil: KEEP }
      : { v: 1, participantToken: "tok-1", participantId: "m1", keepUntil: KEEP };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
}

const ROOM_KEYS = new Set(["room", "room-result", "room-preview"]);

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const original = client.invalidateQueries.bind(client);
  vi.spyOn(client, "invalidateQueries").mockImplementation((filters, options) => {
    const key = filters?.queryKey?.[0];
    if (typeof key === "string" && ROOM_KEYS.has(key)) log.push(`invalidate:${key}`);
    return original(filters, options);
  });
  render(
    <QueryClientProvider client={client}>
      <RoomScreen roomId={ROOM} />
    </QueryClientProvider>,
  );
}

const REFRESH = ["invalidate:room", "invalidate:room-result", "invalidate:room-preview"];
const invalidations = () => log.filter((entry) => entry.startsWith("invalidate:"));

const err = (status: number, code: string) => new ApiRequestError(status, code, "서버 문구");
const ERRORS: readonly { name: string; error: unknown; code: string }[] = [
  { name: "404 ROOM_NOT_FOUND", error: err(404, "ROOM_NOT_FOUND"), code: "ROOM_NOT_FOUND" },
  { name: "409 ROOM_FULL", error: err(409, "ROOM_FULL"), code: "ROOM_FULL" },
  { name: "409 ROOM_LOCKED", error: err(409, "ROOM_LOCKED"), code: "ROOM_LOCKED" },
  { name: "409 ROOM_CHANGED", error: err(409, "ROOM_CHANGED"), code: "ROOM_CHANGED" },
  { name: "401 UNAUTHORIZED", error: err(401, "UNAUTHORIZED"), code: "UNAUTHORIZED" },
  { name: "404 PARTICIPANT_NOT_FOUND", error: err(404, "PARTICIPANT_NOT_FOUND"), code: "PARTICIPANT_NOT_FOUND" },
  { name: "403 FORBIDDEN", error: err(403, "FORBIDDEN"), code: "FORBIDDEN" },
  { name: "429 RATE_LIMITED", error: err(429, "RATE_LIMITED"), code: "RATE_LIMITED" },
  { name: "네트워크 오류", error: new TypeError("Failed to fetch"), code: "NETWORK" },
];

/** 오류 code → 다시 불러오는가. 동작마다 다르다(코드와 별개로 손으로 적은 기대표다). */
const STALE = ["ROOM_FULL", "ROOM_LOCKED", "ROOM_NOT_FOUND", "ROOM_CHANGED"];
const TOKEN = ["UNAUTHORIZED", "PARTICIPANT_NOT_FOUND", "FORBIDDEN"];
const GONE = ["ROOM_NOT_FOUND"];
const REFRESH_ON: Record<string, readonly string[]> = {
  join: STALE,
  edit: [...TOKEN, ...GONE],
  leave: GONE,
  kick: GONE,
  lock: GONE,
  remove: GONE,
};

const confirm = async (user: ReturnType<typeof userEvent.setup>, open: string | RegExp, ok: string) => {
  await user.click(await screen.findByRole("button", { name: open }));
  await user.click(screen.getByRole("button", { name: ok }));
};

/** 동작을 일으키고 그 동작이 쓰는 API 모의를 돌려준다. */
const ACTIONS: Record<
  string,
  { role: Role; api: () => ReturnType<typeof vi.fn>; run: (user: ReturnType<typeof userEvent.setup>) => Promise<void> }
> = {
  join: {
    role: "visitor",
    api: () => vi.mocked(api.joinRoom),
    run: async (user) => {
      await screen.findByRole("heading", { name: "나도 출발역 넣기" });
      await user.type(screen.getByRole("combobox", { name: "내 출발역" }), "ㅎㄷㅇㄱ");
      await user.click(await screen.findByRole("option", { name: /^홍대입구\s?2호선/ }));
      await user.click(screen.getByRole("button", { name: "참여하기" }));
    },
  },
  edit: {
    role: "member",
    api: () => vi.mocked(api.updateParticipant),
    run: async (user) => {
      await user.click(await screen.findByRole("button", { name: "수정 내 항목" }));
      await user.click(await screen.findByRole("button", { name: "저장하기" }));
    },
  },
  leave: {
    role: "member",
    api: () => vi.mocked(api.removeParticipant),
    run: (user) => confirm(user, "삭제 내 항목", "지우기"),
  },
  kick: {
    role: "host",
    api: () => vi.mocked(api.removeParticipant),
    run: async (user) => {
      await user.click(await screen.findByRole("button", { name: "내보내기 참가자 2" }));
      await user.click(screen.getByRole("button", { name: "내보내기" }));
    },
  },
  lock: {
    role: "host",
    api: () => vi.mocked(api.updateRoom),
    run: async (user) => {
      await user.click(await screen.findByRole("button", { name: "참여 잠그기" }));
    },
  },
  remove: {
    role: "host",
    api: () => vi.mocked(api.deleteRoom),
    run: (user) => confirm(user, "방 삭제 방 전체", "방 지우기"),
  },
};

beforeEach(() => {
  vi.mocked(track).mockClear();
  vi.mocked(track).mockImplementation((name) => {
    log.push(`track:${name}`);
  });
  router.push.mockClear();
  window.localStorage.clear();
  members = [];
  locked = false;
  log = [];
  vi.mocked(api.getRoom).mockImplementation(async (_id, token) => roomFor(token));
  vi.mocked(api.getRoomResult).mockImplementation(() => new Promise(() => {}));
  vi.mocked(api.newIdempotencyKey).mockImplementation(() => "key-1");
  vi.mocked(api.updateRoom).mockResolvedValue({ ...roomFor(null), locked: true });
  vi.mocked(api.updateParticipant).mockResolvedValue(undefined as never);
  vi.mocked(api.removeParticipant).mockResolvedValue(undefined);
  vi.mocked(api.deleteRoom).mockResolvedValue(undefined);
  vi.mocked(api.joinRoom).mockResolvedValue({ participantId: "m1", participantToken: "tok-1" });
});

describe("방 화면 쓰기 동작의 오류 처리", () => {
  for (const [action, spec] of Object.entries(ACTIONS)) {
    describe(action, () => {
      it.each(ERRORS)("$name → 문구를 보이고, 다시 불러오기는 정해진 오류에서만 한다", async ({ error, code }) => {
        seed(spec.role);
        spec.api().mockRejectedValue(error);
        renderScreen();
        await spec.run(userEvent.setup());

        const alert = await screen.findByRole("alert");
        expect(alert).toHaveTextContent(roomErrorMessage(error));
        expect(invalidations()).toEqual(REFRESH_ON[action]?.includes(code) ? REFRESH : []);
      });
    });
  }
});

describe("방 화면 쓰기 동작이 성공했을 때", () => {
  const stored = () => JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");

  it("참여: 기기에 기록 → 통계 → 방·결과·미리보기를 이 순서로 다시 불러온다", async () => {
    seed("visitor");
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === STORAGE_KEY) log.push("commit");
      setItem.call(this, key, value);
    });
    renderScreen();
    await ACTIONS.join?.run(userEvent.setup());
    await waitFor(() => expect(invalidations()).toEqual(REFRESH));
    expect(
      log.filter(
        (entry) => entry === "commit" || entry.startsWith("track:participant") || entry.startsWith("invalidate:"),
      ),
    ).toEqual(["commit", "track:participant_joined", ...REFRESH]);
  });

  it("수정: 폼을 닫고 다시 불러온다", async () => {
    seed("member");
    renderScreen();
    await ACTIONS.edit?.run(userEvent.setup());
    await waitFor(() => expect(invalidations()).toEqual(REFRESH));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "내 출발역 고치기" })).not.toBeInTheDocument());
  });

  it("나가기: 참여자 토큰을 기기에서 지우고 다시 불러온다", async () => {
    seed("member");
    renderScreen();
    await ACTIONS.leave?.run(userEvent.setup());
    await waitFor(() => expect(invalidations()).toEqual(REFRESH));
    expect(stored()?.participantToken).toBeUndefined();
  });

  it("내보내기: 다시 불러온다", async () => {
    seed("host");
    renderScreen();
    await ACTIONS.kick?.run(userEvent.setup());
    await waitFor(() => expect(invalidations()).toEqual(REFRESH));
    expect(api.removeParticipant).toHaveBeenCalledWith(ROOM, "m1", "host-tok");
  });

  it("잠금: 다시 불러온다. 정원이 차서 잠긴 방은 풀어도 잠겨 있다는 이유를 알린다", async () => {
    seed("host");
    locked = true;
    vi.mocked(api.updateRoom).mockResolvedValue({ ...roomFor(null), locked: true });
    renderScreen();
    await userEvent.setup().click(await screen.findByRole("button", { name: "잠금 풀기" }));
    await waitFor(() => expect(invalidations()).toEqual(REFRESH));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "정한 예상 인원이 다 차서 잠겨 있어요. 누가 나가면 자동으로 다시 열려요.",
    );
  });

  it("삭제: 기기 기록을 지우고 홈으로 간다(다시 불러오지 않는다)", async () => {
    seed("host");
    renderScreen();
    await ACTIONS.remove?.run(userEvent.setup());
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/"));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(invalidations()).toEqual([]);
  });
});
