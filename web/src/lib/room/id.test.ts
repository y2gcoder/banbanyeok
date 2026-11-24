import { describe, expect, it } from "vitest";
import { isRoomId, NEW_ROOM_PATH, normalizeRoomId, roomPath } from "./id";
import { roomShareLink } from "./share-link";

describe("방 ID와 링크", () => {
  it("10자 Crockford base32만 방 ID다(I·L·O·U 제외, 대소문자 모두)", () => {
    expect(isRoomId("qt7yvmsht3")).toBe(true);
    expect(isRoomId("QT7YVMSHT3")).toBe(true);
    expect(isRoomId("new")).toBe(false);
    expect(isRoomId("qt7yvmsht")).toBe(false);
    expect(isRoomId("qt7yvmsht33")).toBe(false);
    expect(isRoomId("qt7yvmsht!")).toBe(false);
    expect(isRoomId("iiiiiiiiii")).toBe(false);
    expect(isRoomId("../../etc")).toBe(false);
  });

  it("방 경로는 소문자 ID 하나뿐이고, 공유 링크도 공유 번호(sv)와 보이는 범위 정책 버전(pv) 말고는 붙이지 않는다(토큰·해시 없음)", () => {
    expect(roomPath("QT7YVMSHT3")).toBe("/r/qt7yvmsht3");
    expect(normalizeRoomId("QT7YVMSHT3")).toBe("qt7yvmsht3");
    expect(roomPath("qt7yvmsht3")).not.toMatch(/[?#=]/);
    const shared = new URL(roomShareLink("qt7yvmsht3", 4), "https://banbanyeok.app");
    expect(shared.pathname).toBe(roomPath("qt7yvmsht3"));
    expect([...shared.searchParams.keys()]).toEqual(["sv", "pv"]);
    expect(shared.hash).toBe("");
  });

  it("방 만들기 경로는 방 ID가 될 수 없다(3자)", () => {
    expect(isRoomId(NEW_ROOM_PATH.replace("/r/", ""))).toBe(false);
  });
});
