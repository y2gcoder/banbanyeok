import { describe, expect, it } from "vitest";
import { ROOM_OG_IMAGE_VERSION } from "@/lib/copy/og-text";
import { parseDataVersion, parseShareVersion, roomImagePath, roomShareLink, SHARE_VERSION_PARAM } from "./share-link";

describe("방 공유 링크", () => {
  it("공유 번호를 sv로 붙인다(방 ID는 소문자)", () => {
    expect(roomShareLink("QT7YVMSHT3", 12)).toBe("/r/qt7yvmsht3?sv=12");
    expect(SHARE_VERSION_PARAM).toBe("sv");
  });

  it("번호를 모르면(옛 서버) 쿼리 없는 방 링크", () => {
    expect(roomShareLink("qt7yvmsht3", undefined)).toBe("/r/qt7yvmsht3");
  });

  it("방이 예전 상태로 돌아와도 번호가 다르면 링크가 다르다(내용으로 링크를 만들지 않는다)", () => {
    // 혼자 → 친구 참여 → 친구 나감: 방 내용은 처음과 같지만 서버 번호는 1 → 2 → 3이다.
    expect(roomShareLink("qt7yvmsht3", 1)).not.toBe(roomShareLink("qt7yvmsht3", 3));
  });

  it("그림 주소는 번호와 데이터 버전, 그림 버전을 함께 싣는다", () => {
    expect(roomImagePath("qt7yvmsht3", 7, "20261115.8")).toBe(
      `/r/qt7yvmsht3/og?sv=7&dv=20261115.8&iv=${ROOM_OG_IMAGE_VERSION}`,
    );
    // 방 내용이 그대로라 번호가 같아도(다시 공유) 그림 버전이 주소를 가른다. 그림 버전은 값만 붙고 번호·데이터 버전 읽기를 바꾸지 않는다.
    const image = new URL(roomImagePath("qt7yvmsht3", 7, "20261115.8"), "https://banbanyeok.app");
    expect(parseShareVersion(image.searchParams.get(SHARE_VERSION_PARAM))).toBe(7);
    expect(parseDataVersion(image.searchParams)).toBe("20261115.8");
    expect(parseDataVersion(new URLSearchParams("sv=7&dv=20261115.8"))).toBe("20261115.8");
    expect(parseDataVersion(new URLSearchParams("sv=7&dv="))).toBeNull();
    expect(parseDataVersion(new URLSearchParams("sv=7"))).toBeNull();
  });

  it("번호는 0 이상의 정수 하나만 받는다", () => {
    expect(parseShareVersion("0")).toBe(0);
    expect(parseShareVersion("12")).toBe(12);
    for (const bad of ["", "abc", "-1", "+1", "1.5", "1e3", "012", " 1", "0x1", "99999999999999999999"]) {
      expect(parseShareVersion(bad), bad).toBeNull();
    }
    expect(parseShareVersion(["1", "2"])).toBeNull();
    expect(parseShareVersion(undefined)).toBeNull();
    expect(parseShareVersion(null)).toBeNull();
  });
});
