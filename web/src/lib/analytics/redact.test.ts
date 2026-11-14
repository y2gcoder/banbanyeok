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

  it("방 경로의 방 ID를 가린다(방 만들기 경로는 그대로)", () => {
    expect(redactUrl("https://banbanyeok.example/r/qt7yvmsht3?x=1#top")).toBe("https://banbanyeok.example/r/[room]");
    expect(redactUrl("/r/QT7YVMSHT3")).toBe("/r/[room]");
    expect(redactUrl("https://banbanyeok.example/r/new")).toBe("https://banbanyeok.example/r/new");
    expect(redactUrl("/r/qt7yvmsht3/")).toBe("/r/[room]/");
    // 10자가 아니면 방 ID가 아니다(다른 경로를 건드리지 않는다).
    expect(redactUrl("/r/abc")).toBe("/r/abc");
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

  it("방 링크의 방 ID는 어떤 URL 속성에도 남지 않는다(현재·이전·진입 주소)", () => {
    const room = "https://banbanyeok.example/r/qt7yvmsht3";
    const result = redactCapture(
      capture(
        { $current_url: room, $referrer: room, $session_entry_url: room, $pathname: "/r/qt7yvmsht3" },
        { $set_once: { $initial_current_url: room } },
      ),
    );
    expect(JSON.stringify(result)).not.toMatch(/qt7yvmsht3/i);
    expect(result?.properties).toMatchObject({ $current_url: "https://banbanyeok.example/r/[room]" });
  });

  it("위치(GeoIP) 보강을 끈다", () => {
    expect(redactCapture(capture({}))?.properties).toMatchObject({ $geoip_disable: true });
  });

  it("null은 그대로 null", () => {
    expect(redactCapture(null)).toBeNull();
  });
});
