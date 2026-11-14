import { describe, expect, it } from "vitest";
import { maxMinutesBucket, responseTimeBucket } from "./buckets";

describe("구간 값", () => {
  it("최장 소요시간(분): 경계는 아래쪽 포함", () => {
    const cases: [number, string][] = [
      [0, "0-15"],
      [14, "0-15"],
      [15, "15-30"],
      [44, "30-45"],
      [45, "45-60"],
      [59, "45-60"],
      [60, "60-90"],
      [89, "60-90"],
      [90, "90+"],
      [240, "90+"],
    ];
    for (const [minutes, bucket] of cases) expect(maxMinutesBucket(minutes), `${minutes}분`).toBe(bucket);
  });

  it("서버 응답 시간(밀리초)", () => {
    const cases: [number, string][] = [
      [0, "0-300"],
      [299, "0-300"],
      [300, "300-1000"],
      [999, "300-1000"],
      [1000, "1000-3000"],
      [2999, "1000-3000"],
      [3000, "3000+"],
      [12_000, "3000+"],
    ];
    for (const [ms, bucket] of cases) expect(responseTimeBucket(ms), `${ms}ms`).toBe(bucket);
  });
});
