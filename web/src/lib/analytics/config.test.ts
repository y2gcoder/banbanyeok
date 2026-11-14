import { describe, expect, it } from "vitest";
import { analyticsConfig, POSTHOG_HOSTS } from "./config";

const KEY = `phc_${"a".repeat(30)}`;

describe("analyticsConfig", () => {
  it("키가 없거나 비어 있으면 꺼진다", () => {
    expect(analyticsConfig({})).toBeNull();
    expect(analyticsConfig({ key: "", host: POSTHOG_HOSTS.us })).toBeNull();
    expect(analyticsConfig({ key: "   ", host: POSTHOG_HOSTS.us })).toBeNull();
  });

  it("키가 있어도 호스트가 없거나 US/EU가 아니면 꺼진다(리전을 추측하지 않는다)", () => {
    expect(analyticsConfig({ key: KEY })).toBeNull();
    expect(analyticsConfig({ key: KEY, host: "https://example.com" })).toBeNull();
    expect(analyticsConfig({ key: KEY, host: "http://us.i.posthog.com" })).toBeNull();
  });

  it("개인 API 키(phx_)와 형식이 다른 값은 거부한다", () => {
    expect(analyticsConfig({ key: `phx_${"a".repeat(30)}`, host: POSTHOG_HOSTS.us })).toBeNull();
    expect(analyticsConfig({ key: "phc_short", host: POSTHOG_HOSTS.us })).toBeNull();
  });

  it("US·EU 호스트는 끝의 /를 허용하고 정규화한다", () => {
    expect(analyticsConfig({ key: KEY, host: "https://us.i.posthog.com/" })).toEqual({
      key: KEY,
      host: POSTHOG_HOSTS.us,
    });
    expect(analyticsConfig({ key: ` ${KEY} `, host: POSTHOG_HOSTS.eu })).toEqual({ key: KEY, host: POSTHOG_HOSTS.eu });
  });
});
