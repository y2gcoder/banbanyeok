import { describe, expect, it } from "vitest";
import { decodeShareQuery } from "@/lib/link/codec";
import { recommendBody } from "./client";
import { recommendQueryOptions } from "./queries";

function stateOf(query: string) {
  const decoded = decodeShareQuery(query);
  if (!decoded.ok) throw new Error(`decode failed: ${decoded.error}`);
  return decoded.state;
}

describe("추천 요청 본문의 구분(timeSlot)", () => {
  it("구분을 고른 링크(v=2)는 구분을 보낸다", () => {
    expect(recommendBody(stateOf("v=2&o=03v.130&m=f&t=saturday-night"))).toEqual({
      origins: ["03v", "130"],
      mode: "fair",
      timeSlot: "saturday-night",
    });
    // 평일 낮을 직접 고른 것도 고른 것이다.
    expect(recommendBody(stateOf("v=2&o=03v.130&m=f&t=weekday-day")).timeSlot).toBe("weekday-day");
  });

  it("옛 링크(v=1)는 구분을 보내지 않는다: 서버가 요일을 모르는 요청으로 보고 막차 시각을 내지 않는다", () => {
    const body = recommendBody(stateOf("v=1&o=03v.130&m=f"));
    expect(body).toEqual({ origins: ["03v", "130"], mode: "fair" });
    expect("timeSlot" in body).toBe(false);
  });

  it("옛 링크에서 기준 탭을 바꿔도(상태를 펼쳐 복사) 구분은 여전히 보내지 않는다", () => {
    const body = recommendBody({ ...stateOf("v=1&o=03v.130&m=f"), mode: "fast" });
    expect(body).toEqual({ origins: ["03v", "130"], mode: "fast" });
  });

  it("같은 역·같은 평일 낮이어도 구분을 보내는 요청과 보내지 않는 요청은 캐시 키가 다르다", () => {
    const legacy = recommendQueryOptions(stateOf("v=1&o=03v.130&m=f")).queryKey;
    const chosen = recommendQueryOptions(stateOf("v=2&o=03v.130&m=f&t=weekday-day")).queryKey;
    expect(legacy).not.toEqual(chosen);
  });
});
