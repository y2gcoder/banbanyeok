// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  canStoreRoomTokens,
  dropParticipantToken,
  loadRoomRecord,
  patchRoomRecord,
  pruneExpiredRooms,
  ROOM_KEY_PREFIX,
  removeRoomRecord,
  roomKey,
  saveRoomRecord,
} from "./tokens";

const ROOM = "qt7yvmsht3";
const NOW = Date.parse("2026-11-15T00:00:00Z");
const future = "2026-11-20T00:00:00Z";
const past = "2026-11-14T00:00:00Z";

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("방 토큰 기기 저장", () => {
  it("방 ID별 키 하나에 저장하고 대소문자 구별 없이 같은 기록을 읽는다", () => {
    saveRoomRecord(ROOM, { hostToken: "h", participantToken: "p", participantId: "pid", expiresAt: future });
    expect(roomKey("QT7YVMSHT3")).toBe(`${ROOM_KEY_PREFIX}${ROOM}`);
    expect(loadRoomRecord("QT7YVMSHT3", NOW)).toMatchObject({ v: 1, hostToken: "h", participantToken: "p" });
    expect(window.localStorage.length).toBe(1);
  });

  it("만료된 기록은 읽을 때 없는 것으로 보이고 그 자리에서 지워진다", () => {
    saveRoomRecord(ROOM, { participantToken: "p", expiresAt: past });
    expect(loadRoomRecord(ROOM, NOW)).toBeNull();
    expect(window.localStorage.getItem(roomKey(ROOM))).toBeNull();
  });

  it("깨진 기록(JSON 아님·형식 다름)은 null이고 지운다", () => {
    window.localStorage.setItem(roomKey(ROOM), "{not json");
    expect(loadRoomRecord(ROOM, NOW)).toBeNull();
    expect(window.localStorage.getItem(roomKey(ROOM))).toBeNull();
    window.localStorage.setItem(roomKey(ROOM), JSON.stringify({ v: 2, expiresAt: future }));
    expect(loadRoomRecord(ROOM, NOW)).toBeNull();
  });

  it("pruneExpiredRooms는 만료·깨진 방 기록만 지우고 다른 키와 살아 있는 방은 둔다", () => {
    saveRoomRecord("aaaaaaaaaa", { participantToken: "p1", expiresAt: past });
    saveRoomRecord("bbbbbbbbbb", { participantToken: "p2", expiresAt: future });
    window.localStorage.setItem(`${ROOM_KEY_PREFIX}cccccccccc`, "garbage");
    window.localStorage.setItem("banbanyeok:me", '{"code":"03v","nickname":""}');
    window.localStorage.setItem("bby.analytics.consent", "{}");
    expect(pruneExpiredRooms(NOW)).toBe(2);
    expect(window.localStorage.getItem(roomKey("aaaaaaaaaa"))).toBeNull();
    expect(window.localStorage.getItem(`${ROOM_KEY_PREFIX}cccccccccc`)).toBeNull();
    expect(loadRoomRecord("bbbbbbbbbb", NOW)).not.toBeNull();
    expect(window.localStorage.getItem("banbanyeok:me")).not.toBeNull();
    expect(window.localStorage.getItem("bby.analytics.consent")).not.toBeNull();
  });

  it("patchRoomRecord는 일부만 바꾸고 undefined인 키는 지운다", () => {
    saveRoomRecord(ROOM, { hostToken: "h", participantToken: "p", participantId: "pid", expiresAt: future });
    const next = patchRoomRecord(ROOM, { expiresAt: "2026-11-25T00:00:00Z", participantToken: undefined });
    expect(next).toMatchObject({ hostToken: "h", participantId: "pid", expiresAt: "2026-11-25T00:00:00Z" });
    expect(next).not.toHaveProperty("participantToken");
    expect(patchRoomRecord("zzzzzzzzzz", { expiresAt: future })).toBeNull();
  });

  it("dropParticipantToken: 방장이면 기록을 남기고, 방장이 아니면 기록 전체를 지운다", () => {
    saveRoomRecord(ROOM, { hostToken: "h", participantToken: "p", participantId: "pid", expiresAt: future });
    expect(dropParticipantToken(ROOM)).toMatchObject({ hostToken: "h" });
    expect(loadRoomRecord(ROOM)?.participantToken).toBeUndefined();
    saveRoomRecord("bbbbbbbbbb", { participantToken: "p", participantId: "pid", expiresAt: future });
    expect(dropParticipantToken("bbbbbbbbbb")).toBeNull();
    expect(window.localStorage.getItem(roomKey("bbbbbbbbbb"))).toBeNull();
  });

  it("removeRoomRecord", () => {
    saveRoomRecord(ROOM, { participantToken: "p", expiresAt: future });
    removeRoomRecord(ROOM);
    expect(loadRoomRecord(ROOM)).toBeNull();
  });

  it("저장소가 막혀 있어도 던지지 않는다(저장·읽기·정리 모두 조용히 실패)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(() => saveRoomRecord(ROOM, { participantToken: "p", expiresAt: future })).not.toThrow();
    expect(loadRoomRecord(ROOM)).toBeNull();
    expect(pruneExpiredRooms()).toBe(0);
    expect(canStoreRoomTokens()).toBe(false);
  });

  it("canStoreRoomTokens는 정상 환경에서 true이고 흔적을 남기지 않는다", () => {
    expect(canStoreRoomTokens()).toBe(true);
    expect(window.localStorage.length).toBe(0);
  });
});
