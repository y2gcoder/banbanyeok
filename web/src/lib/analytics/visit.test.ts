// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readAnalyticsId, referrerKind, trackingDeclined } from "./visit";

const OWN = "banbanyeok.example";
const CHROME = "Mozilla/5.0 (Linux; Android 14) Chrome/130";

describe("referrerKind", () => {
  it("리퍼러가 없으면 direct", () => {
    expect(referrerKind("", CHROME, OWN)).toBe("direct");
  });

  it("카카오톡 인앱 브라우저(UA) 또는 카카오 도메인은 kakao", () => {
    expect(referrerKind("", "Mozilla/5.0 KAKAOTALK 11.0", OWN)).toBe("kakao");
    expect(referrerKind("https://talk.kakao.com/x", CHROME, OWN)).toBe("kakao");
    expect(referrerKind("https://www.kakaotalk.com/", CHROME, OWN)).toBe("kakao");
  });

  it("검색 엔진은 search, 나머지는 other, 같은 사이트는 direct", () => {
    expect(referrerKind("https://www.google.com/", CHROME, OWN)).toBe("search");
    expect(referrerKind("https://www.google.co.kr/search?q=x", CHROME, OWN)).toBe("search");
    expect(referrerKind("https://search.naver.com/search.naver?query=x", CHROME, OWN)).toBe("search");
    expect(referrerKind("https://blog.naver.com/abc", CHROME, OWN)).toBe("other");
    expect(referrerKind("https://example.org/", CHROME, OWN)).toBe("other");
    expect(referrerKind(`https://${OWN}/meet`, CHROME, OWN)).toBe("direct");
    expect(referrerKind("not a url", CHROME, OWN)).toBe("other");
  });
});

describe("trackingDeclined", () => {
  afterEach(() => vi.restoreAllMocks());

  it("신호가 없으면 거부가 아니다", () => {
    expect(trackingDeclined()).toBe(false);
  });

  it("Do Not Track이나 Global Privacy Control이 켜져 있으면 거부다", () => {
    Object.defineProperty(window.navigator, "doNotTrack", { value: "1", configurable: true });
    expect(trackingDeclined()).toBe(true);
    Reflect.deleteProperty(window.navigator, "doNotTrack");
    expect(trackingDeclined()).toBe(false);
    Object.defineProperty(window.navigator, "globalPrivacyControl", { value: true, configurable: true });
    expect(trackingDeclined()).toBe(true);
    Reflect.deleteProperty(window.navigator, "globalPrivacyControl");
  });
});

describe("readAnalyticsId", () => {
  beforeEach(() => window.localStorage.clear());

  it("PostHog가 저장한 distinct_id를 읽고, 없거나 깨졌으면 null", () => {
    expect(readAnalyticsId()).toBeNull();
    window.localStorage.setItem("banbanyeok:me", JSON.stringify({ distinct_id: "nope" }));
    expect(readAnalyticsId()).toBeNull();
    window.localStorage.setItem("ph_phc_x_posthog", "not json");
    expect(readAnalyticsId()).toBeNull();
    window.localStorage.setItem(
      "ph_phc_x_posthog",
      JSON.stringify({ distinct_id: "abc-123", $user_state: "anonymous" }),
    );
    expect(readAnalyticsId()).toBe("abc-123");
  });
});
