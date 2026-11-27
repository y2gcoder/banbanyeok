import { describe, expect, it } from "vitest";
import { ROOM_OG_IMAGE_VERSION, ROOM_SHARE_POLICY_VERSION } from "@/lib/copy/og-text";
import { parseDataVersion, parseShareVersion, roomImagePath, roomShareLink, SHARE_VERSION_PARAM } from "./share-link";

describe("방 공유 링크", () => {
  it("공유 번호를 sv로, 보이는 범위 정책 버전을 pv로 붙인다(방 ID는 소문자)", () => {
    expect(roomShareLink("QT7YVMSHT3", 12)).toBe(`/r/qt7yvmsht3?sv=12&pv=${ROOM_SHARE_POLICY_VERSION}`);
    expect(ROOM_SHARE_POLICY_VERSION).toBe(4);
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
      `/r/qt7yvmsht3/og?sv=7&dv=20261115.8&pv=${ROOM_SHARE_POLICY_VERSION}&iv=${ROOM_OG_IMAGE_VERSION}`,
    );
    // 방 내용이 그대로라 번호가 같아도(다시 공유) 그림 버전이 주소를 가른다. 그림 버전은 값만 붙고 번호·데이터 버전 읽기를 바꾸지 않는다.
    const image = new URL(roomImagePath("qt7yvmsht3", 7, "20261115.8"), "https://banbanyeok.app");
    expect(parseShareVersion(image.searchParams.get(SHARE_VERSION_PARAM))).toBe(7);
    expect(parseDataVersion(image.searchParams)).toBe("20261115.8");
    expect(parseDataVersion(new URLSearchParams("sv=7&dv=20261115.8"))).toBe("20261115.8");
    expect(parseDataVersion(new URLSearchParams("sv=7&dv="))).toBeNull();
    expect(parseDataVersion(new URLSearchParams("sv=7"))).toBeNull();
  });

  it("보이는 범위 정책 버전이 다르면 방 내용(번호·데이터 버전)이 같아도 링크와 그림 주소가 다르다(#142: 배포 전 캐시를 받지 않는다)", () => {
    // 배포 전(정책 1)에 공유한 링크·그림 주소와, 방을 고치지 않고 배포 뒤(정책 2) 다시 공유한 주소.
    expect(roomShareLink("qt7yvmsht3", 3, 1)).toBe("/r/qt7yvmsht3?sv=3&pv=1");
    expect(roomShareLink("qt7yvmsht3", 3)).not.toBe(roomShareLink("qt7yvmsht3", 3, 1));
    expect(roomImagePath("qt7yvmsht3", 3, "20261123.1")).not.toBe(roomImagePath("qt7yvmsht3", 3, "20261123.1", 1));
    // 정책 버전은 번호 읽기를 바꾸지 않는다.
    const link = new URL(roomShareLink("qt7yvmsht3", 3), "https://banbanyeok.app");
    expect(parseShareVersion(link.searchParams.get(SHARE_VERSION_PARAM))).toBe(3);
  });

  it("정책 2 → 3(#162: 기본 기준이 숨긴 사람 쪽인 방은 남에게 공평하게)도 배포 전 캐시를 받지 않는다", () => {
    // 그런 방을 배포 전(정책 2)에 공유해 캐시 → 방을 고치지 않고 배포 → 다시 공유: 링크와 그림 주소가 달라야 한다.
    expect(roomShareLink("qt7yvmsht3", 6, 2)).toBe("/r/qt7yvmsht3?sv=6&pv=2");
    expect(roomShareLink("qt7yvmsht3", 6)).toBe("/r/qt7yvmsht3?sv=6&pv=4");
    expect(roomImagePath("qt7yvmsht3", 6, "20261120.1")).not.toBe(roomImagePath("qt7yvmsht3", 6, "20261120.1", 2));
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
