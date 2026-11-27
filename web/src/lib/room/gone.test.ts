// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type HostProbe, settleRoomNotFound } from "./gone";
import { loadRoomRecord, type RoomRecord, roomKey } from "./tokens";

const ROOM = "qt7yvmsht3";
const KEEP = "2999-01-01T00:00:00Z";
const both: RoomRecord = {
  v: 1,
  hostToken: "host-tok",
  participantToken: "part-tok",
  participantId: "p1",
  keepUntil: KEEP,
};
const hostOnly: RoomRecord = { v: 1, hostToken: "host-tok", keepUntil: KEEP };
const memberOnly: RoomRecord = { v: 1, participantToken: "part-tok", participantId: "p1", keepUntil: KEEP };

const store = (record: RoomRecord | null) =>
  record ? localStorage.setItem(roomKey(ROOM), JSON.stringify(record)) : localStorage.removeItem(roomKey(ROOM));
const probe = (answer: Awaited<ReturnType<HostProbe>>) => vi.fn<HostProbe>(async () => answer);

beforeEach(() => localStorage.clear());

describe("settleRoomNotFound: a 404 for a room this device holds tokens for", () => {
  it("keeps the host token and drops only the participant token when the host token still opens the room (200 or 403)", async () => {
    store(both);
    const asHost = probe("exists");
    expect(await settleRoomNotFound(ROOM, both, asHost)).toEqual({ kind: "kept", record: hostOnly });
    expect(asHost).toHaveBeenCalledWith("host-tok");
    expect(loadRoomRecord(ROOM)).toEqual(hostOnly);
  });

  it("deletes the record only when the host token also gets 404", async () => {
    store(both);
    expect(await settleRoomNotFound(ROOM, both, probe("gone"))).toEqual({ kind: "gone" });
    expect(loadRoomRecord(ROOM)).toBeNull();
  });

  it("deletes the record without asking again when the 404 already came for the host token or there is no host token", async () => {
    for (const record of [hostOnly, memberOnly]) {
      store(record);
      const asHost = probe("exists");
      expect(await settleRoomNotFound(ROOM, record, asHost)).toEqual({ kind: "gone" });
      expect(asHost).not.toHaveBeenCalled();
      expect(loadRoomRecord(ROOM)).toBeNull();
    }
  });

  it("keeps everything when it cannot tell (connection error)", async () => {
    store(both);
    expect(await settleRoomNotFound(ROOM, both, probe("unknown"))).toEqual({ kind: "unknown" });
    expect(loadRoomRecord(ROOM)).toMatchObject({ hostToken: "host-tok", participantToken: "part-tok" });
  });

  it("does not delete what another tab already changed: the late 404 of an old token reloads with the stored record", async () => {
    // 다른 탭에서 방장이 자기 항목을 지웠다: 저장소에는 방장 토큰만 남았고, 이 탭은 아직 옛 참여자 토큰을 들고 있었다.
    store(hostOnly);
    const asHost = probe("gone");
    expect(await settleRoomNotFound(ROOM, both, asHost)).toEqual({ kind: "kept", record: hostOnly });
    expect(asHost).not.toHaveBeenCalled();
    expect(loadRoomRecord(ROOM)).toEqual(hostOnly);
  });

  it("does not delete a record another tab saved while the host token was being checked", async () => {
    store(both);
    const rejoined: RoomRecord = { ...both, participantToken: "new-part-tok", participantId: "p2" };
    const slowProbe = vi.fn<HostProbe>(async () => {
      store(rejoined);
      return "gone";
    });
    expect(await settleRoomNotFound(ROOM, both, slowProbe)).toEqual({ kind: "kept", record: rejoined });
    expect(loadRoomRecord(ROOM)).toEqual(rejoined);
  });

  it("treats a record removed by another tab as nothing to delete", async () => {
    store(null);
    expect(await settleRoomNotFound(ROOM, both, probe("exists"))).toEqual({ kind: "kept", record: null });
  });
});
