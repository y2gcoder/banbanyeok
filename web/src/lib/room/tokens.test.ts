// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  canStoreRoomTokens,
  keepUntilFrom,
  loadRoomRecord,
  pruneExpiredRooms,
  ROOM_KEY_PREFIX,
  removeRoomRecord,
  roomKey,
  saveRoomRecord,
  withoutParticipant,
  writeRoomRecord,
} from "./tokens";

const ROOM = "qt7yvmsht3";
const DAY = 86_400_000;
const NOW = Date.parse("2026-11-15T00:00:00Z");
const keepUntil = keepUntilFrom(NOW); // 2026-12-15
const past = "2026-11-14T00:00:00Z";

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("방 토큰 기기 저장", () => {
  it("방 ID별 키 하나에 저장하고 대소문자 구별 없이 같은 기록을 읽는다", () => {
    saveRoomRecord(ROOM, { hostToken: "h", participantToken: "p", participantId: "pid", keepUntil });
    expect(roomKey("QT7YVMSHT3")).toBe(`${ROOM_KEY_PREFIX}${ROOM}`);
    expect(loadRoomRecord("QT7YVMSHT3", NOW)).toMatchObject({ v: 1, hostToken: "h", participantToken: "p" });
    expect(window.localStorage.length).toBe(1);
  });

  it("저장했는지 돌려준다: 짧은 검사는 통과해도 실제 기록이 저장 공간 부족으로 실패하면 false이고 던지지 않는다", () => {
    expect(saveRoomRecord(ROOM, { hostToken: "h", keepUntil })).toBe(true);
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key === roomKey("bbbbbbbbbb")) throw new DOMException("quota", "QuotaExceededError");
      original.call(this, key, value);
    });
    expect(canStoreRoomTokens()).toBe(true);
    expect(saveRoomRecord("bbbbbbbbbb", { hostToken: "h2", keepUntil })).toBe(false);
    expect(loadRoomRecord("bbbbbbbbbb", NOW)).toBeNull();
  });

  it("keepUntil은 처음 저장한 시각 + 30일(방 최대 수명)", () => {
    expect(Date.parse(keepUntil) - NOW).toBe(30 * DAY);
  });

  it("살아 있는 방의 토큰을 기기가 먼저 지우지 않는다: 서버는 활동마다 만료를 7일씩 미루므로, 8일째·29일째에 열어도 그대로다", () => {
    saveRoomRecord(ROOM, { hostToken: "h", participantToken: "p", participantId: "pid", keepUntil });
    for (const days of [8, 15, 29]) {
      expect(pruneExpiredRooms(NOW + days * DAY)).toBe(0);
      expect(loadRoomRecord(ROOM, NOW + days * DAY)?.hostToken).toBe("h");
    }
  });

  it("최대 수명(30일)이 지난 기록만 읽을 때 없는 것으로 보이고 그 자리에서 지워진다", () => {
    saveRoomRecord(ROOM, { participantToken: "p", keepUntil });
    expect(loadRoomRecord(ROOM, NOW + 30 * DAY)).toBeNull();
    expect(window.localStorage.getItem(roomKey(ROOM))).toBeNull();
  });

  it("깨진 기록(JSON 아님·형식 다름·옛 expiresAt 형식)은 null이고 지운다", () => {
    window.localStorage.setItem(roomKey(ROOM), "{not json");
    expect(loadRoomRecord(ROOM, NOW)).toBeNull();
    expect(window.localStorage.getItem(roomKey(ROOM))).toBeNull();
    window.localStorage.setItem(roomKey(ROOM), JSON.stringify({ v: 1, participantToken: "p", expiresAt: keepUntil }));
    expect(loadRoomRecord(ROOM, NOW)).toBeNull();
  });

  it("pruneExpiredRooms는 최대 수명이 지난·깨진 방 기록만 지우고 다른 키와 살아 있는 방은 둔다", () => {
    saveRoomRecord("aaaaaaaaaa", { participantToken: "p1", keepUntil: past });
    saveRoomRecord("bbbbbbbbbb", { participantToken: "p2", keepUntil });
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

  it("withoutParticipant: 방장이면 방장 기록을 남기고, 방장이 아니면 null", () => {
    const base = { v: 1 as const, participantToken: "p", participantId: "pid", keepUntil };
    expect(withoutParticipant({ ...base, hostToken: "h", expectedCount: 3 })).toEqual({
      v: 1,
      hostToken: "h",
      keepUntil,
      expectedCount: 3,
    });
    expect(withoutParticipant(base)).toBeNull();
  });

  it("writeRoomRecord: 저장하거나 null이면 지운다", () => {
    writeRoomRecord(ROOM, { v: 1, participantToken: "p", keepUntil });
    expect(loadRoomRecord(ROOM, NOW)?.participantToken).toBe("p");
    writeRoomRecord(ROOM, null);
    expect(loadRoomRecord(ROOM, NOW)).toBeNull();
  });

  it("removeRoomRecord", () => {
    saveRoomRecord(ROOM, { participantToken: "p", keepUntil });
    removeRoomRecord(ROOM);
    expect(loadRoomRecord(ROOM, NOW)).toBeNull();
  });

  it("저장소가 막혀 있어도 던지지 않는다(저장·읽기·정리 모두 조용히 실패)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(() => saveRoomRecord(ROOM, { participantToken: "p", keepUntil })).not.toThrow();
    expect(() => writeRoomRecord(ROOM, { v: 1, participantToken: "p", keepUntil })).not.toThrow();
    expect(loadRoomRecord(ROOM)).toBeNull();
    expect(pruneExpiredRooms()).toBe(0);
    expect(canStoreRoomTokens()).toBe(false);
  });

  it("canStoreRoomTokens는 정상 환경에서 true이고 흔적을 남기지 않는다", () => {
    expect(canStoreRoomTokens()).toBe(true);
    expect(window.localStorage.length).toBe(0);
  });
});
