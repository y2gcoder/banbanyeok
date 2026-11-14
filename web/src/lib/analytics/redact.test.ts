import type { CaptureResult } from "posthog-js";
import { describe, expect, it } from "vitest";
import { redactCapture, redactUrl } from "./redact";

const SHARE_URL = "https://banbanyeok.example/s?o=ABC.DEF&n=%EB%AF%BC%EC%A7%80&m=favor.1#top";

function capture(properties: Record<string, unknown>, extra: Partial<CaptureResult> = {}): CaptureResult {
  return { uuid: "u", event: "result_viewed", properties, ...extra } as CaptureResult;
}

describe("redactUrl", () => {
  it("공유 링크의 쿼리와 해시를 뗀다", () => {
    expect(redactUrl(SHARE_URL)).toBe("https://banbanyeok.example/s");
    expect(redactUrl("https://banbanyeok.example/meet?x=1")).toBe("https://banbanyeok.example/meet");
  });

  it("조합 페이지 경로의 역 코드를 가린다(주소·경로 모두)", () => {
    expect(redactUrl("https://banbanyeok.example/meet/e87-k3a?x=1")).toBe("https://banbanyeok.example/meet/[pair]");
    expect(redactUrl("/meet/e87-k3a")).toBe("/meet/[pair]");
    expect(redactUrl("/meet")).toBe("/meet");
  });

  it("주소가 아닌 값은 문자열만 자른다", () => {
    expect(redactUrl("$direct")).toBe("$direct");
    expect(redactUrl("/s?o=ABC")).toBe("/s");
  });
});

describe("redactCapture(before_send)", () => {
  it("URL류 자동 속성에서 쿼리를 지우고 다른 속성은 건드리지 않는다", () => {
    const result = redactCapture(
      capture(
        {
          $current_url: SHARE_URL,
          $referrer: SHARE_URL,
          $initial_referrer: "https://www.google.com/search?q=%EA%B0%95%EB%82%A8",
          $session_entry_url: SHARE_URL,
          $pathname: "/meet/e87-k3a",
          $session_entry_pathname: "/s",
          participant_count: 2,
        },
        { $set_once: { $initial_current_url: SHARE_URL }, $set: { $current_url: SHARE_URL } },
      ),
    );
    expect(result?.properties).toMatchObject({
      $current_url: "https://banbanyeok.example/s",
      $referrer: "https://banbanyeok.example/s",
      $initial_referrer: "https://www.google.com/search",
      $session_entry_url: "https://banbanyeok.example/s",
      $pathname: "/meet/[pair]",
      $session_entry_pathname: "/s",
      participant_count: 2,
    });
    expect(result?.$set_once).toEqual({ $initial_current_url: "https://banbanyeok.example/s" });
    expect(result?.$set).toEqual({ $current_url: "https://banbanyeok.example/s" });
    expect(JSON.stringify(result)).not.toContain("ABC");
  });

  it("위치(GeoIP) 보강을 끈다", () => {
    expect(redactCapture(capture({}))?.properties).toMatchObject({ $geoip_disable: true });
  });

  it("null은 그대로 null", () => {
    expect(redactCapture(null)).toBeNull();
  });
});
