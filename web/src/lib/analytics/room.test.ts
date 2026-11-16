import { describe, expect, it } from "vitest";
import { roomHashOf, roomHashProperty, secondsSinceRoomCreated } from "./room";

const ROOM = "qt7yvmsht3";
const HASH = "0f1e2d3c4b5a6978";

describe("room_hash(서버가 준 방 해시)", () => {
  it("서버가 준 16자리 hex를 그대로 쓴다", () => {
    expect(roomHashOf({ roomId: ROOM, roomHash: HASH })).toBe(HASH);
    expect(roomHashProperty({ roomId: ROOM, roomHash: HASH })).toEqual({ room_hash: HASH });
  });

  it("방 ID 원문은 절대 room_hash가 되지 않는다(형식이 다르거나 방 ID를 담고 있으면 보내지 않는다)", () => {
    expect(roomHashOf({ roomId: ROOM, roomHash: ROOM })).toBeUndefined();
    expect(roomHashOf({ roomId: ROOM, roomHash: `${ROOM}abcdef` })).toBeUndefined();
    expect(roomHashOf({ roomId: ROOM, roomHash: ROOM.toUpperCase() })).toBeUndefined();
    // 10자 base32 방 ID가 우연히 hex로만 이뤄져도 길이가 16이 아니므로 통과할 수 없다.
    expect(roomHashOf({ roomId: "0123456789", roomHash: "0123456789" })).toBeUndefined();
    expect(roomHashOf({ roomId: "0123456789", roomHash: "0123456789abcdef" })).toBeUndefined();
    for (const hash of [ROOM, HASH])
      expect(roomHashProperty({ roomId: ROOM, roomHash: hash }).room_hash).not.toBe(ROOM);
  });

  it("옛 서버(필드 없음)나 이상한 값이면 생략한다", () => {
    expect(roomHashProperty({ roomId: ROOM })).toEqual({});
    expect(roomHashProperty({ roomId: ROOM, roomHash: "" })).toEqual({});
    expect(roomHashProperty({ roomId: ROOM, roomHash: "0F1E2D3C4B5A6978" })).toEqual({});
    expect(roomHashProperty({ roomId: ROOM, roomHash: "0f1e2d3c4b5a69780" })).toEqual({});
  });
});

describe("seconds_since_room_created", () => {
  const created = "2026-11-16T00:00:00Z";

  it("방 생성 시각부터 지난 초(정수)", () => {
    expect(secondsSinceRoomCreated(created, Date.parse("2026-11-16T00:01:30.900Z"))).toBe(90);
  });

  it("기기 시계가 느려 음수가 되면 0", () => {
    expect(secondsSinceRoomCreated(created, Date.parse("2026-11-15T23:59:00Z"))).toBe(0);
  });

  it("없거나 읽을 수 없으면 생략(undefined)", () => {
    expect(secondsSinceRoomCreated(undefined)).toBeUndefined();
    expect(secondsSinceRoomCreated("어제")).toBeUndefined();
  });
});
