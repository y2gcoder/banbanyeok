import { describe, expect, it } from "vitest";
import { SHARED_OG_IMAGE_VERSION } from "@/lib/copy/og-text";
import { decodeShareQuery, type ShareState } from "@/lib/link/codec";
import { sharedImagePath } from "./share-url";

const state: ShareState = {
  origins: ["1qs", "70x"],
  mode: "fair",
  favorIndex: null,
  nicknames: ["지훈🎂", null],
  timeSlot: "weekday-day",
};

describe("og:image 주소", () => {
  it("링크 상태 그대로에 데이터 버전을 붙여 캐시를 비켜 간다", () => {
    const path = sharedImagePath(state, "20261112.6");
    expect(path.startsWith("/s/og?v=2&o=1qs.70x&m=f&t=weekday-day&n=")).toBe(true);
    expect(path.endsWith(`&dv=20261112.6&iv=${SHARED_OG_IMAGE_VERSION}`)).toBe(true);
  });

  it("그림 디자인 버전(iv)이 주소에 든다: 디자인이 바뀌면 같은 결과도 새 주소가 된다(카카오 캐시를 비켜 간다)", () => {
    expect(sharedImagePath(state, "1")).toMatch(/&iv=[0-9a-f]{8}$/);
    expect(sharedImagePath(state, "1")).toContain(`iv=${SHARED_OG_IMAGE_VERSION}`);
  });

  it("옛 공유 링크(v=1)와 새 링크(v=2)의 쿼리 모두 같은 그림 주소 규칙에서 읽힌다(iv·dv는 무시)", () => {
    const legacy: ShareState = { ...state, nicknames: null };
    const v1 = decodeShareQuery("v=1&o=1qs.70x&m=f&iv=abcdef01&dv=1");
    // v=1은 구분을 고른 적이 없다는 표시가 붙는다(추천 요청에서 구분을 빼는 데 쓴다).
    expect(v1).toEqual({ ok: true, state: { ...legacy, slotDefaulted: true } });
    expect(decodeShareQuery("v=2&o=1qs.70x&m=f&t=weekday-day&iv=abcdef01&dv=1")).toEqual({ ok: true, state: legacy });
  });

  it("그 주소의 쿼리를 링크 코덱이 그대로 읽는다(dv는 무시)", () => {
    const query = sharedImagePath(state, "20261112.6").split("?")[1] ?? "";
    expect(decodeShareQuery(query)).toEqual({ ok: true, state });
  });
});
