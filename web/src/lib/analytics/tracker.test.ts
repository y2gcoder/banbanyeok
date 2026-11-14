import type { PostHogConfig } from "posthog-js";
import { describe, expect, it, vi } from "vitest";
import { POSTHOG_HOSTS } from "./config";
import { AnalyticsContractError } from "./properties";
import { redactCapture } from "./redact";
import { createTracker, type PostHogClient, posthogOptions, type TrackerDeps } from "./tracker";

const config = { key: `phc_${"a".repeat(30)}`, host: POSTHOG_HOSTS.eu };

function fakePostHog() {
  const init = vi.fn<(token: string, options: Partial<PostHogConfig>) => void>();
  const capture = vi.fn<(event: string, properties?: Record<string, unknown>) => void>();
  const client: PostHogClient = { init, capture };
  return { client, init, capture };
}

function setup(overrides: Partial<TrackerDeps> = {}) {
  const posthog = fakePostHog();
  const loadPostHog = vi.fn(() => Promise.resolve(posthog.client));
  const tracker = createTracker({ config, appVersion: "abc1234", declined: () => false, loadPostHog, ...overrides });
  return { tracker, loadPostHog, ...posthog };
}

const inputCompleted = { participant_count: 3, has_custom_name: true, mode: "fair", input_ms: 4200 } as const;

describe("키가 없으면 완전히 꺼진다", () => {
  it("PostHog를 불러오지도, 초기화하지도, 보내지도 않는다", async () => {
    const { tracker, loadPostHog, init, capture } = setup({ config: null });
    tracker.track("input_completed", inputCompleted);
    tracker.track("mode_switched", { from_mode: "fair", to_mode: "fast", favor_used: false });
    await Promise.resolve();
    expect(tracker.enabled()).toBe(false);
    expect(loadPostHog).not.toHaveBeenCalled();
    expect(init).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });

  it("브라우저가 추적을 거부해도(DNT·GPC) 마찬가지다", async () => {
    const { tracker, loadPostHog, capture } = setup({ declined: () => true });
    tracker.track("input_completed", inputCompleted);
    await Promise.resolve();
    expect(loadPostHog).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });

  it("꺼져 있어도 계약 위반은 테스트에서 잡힌다", () => {
    const { tracker } = setup({ config: null });
    // @ts-expect-error 계약에 없는 속성
    expect(() => tracker.track("input_completed", { ...inputCompleted, origin_codes: "ABC" })).toThrow(
      AnalyticsContractError,
    );
  });
});

describe("켜져 있을 때", () => {
  it("첫 이벤트에서 한 번만 불러와 초기화하고, 대기열의 이벤트를 순서대로 공통 속성과 함께 보낸다", async () => {
    const { tracker, loadPostHog, init, capture } = setup();
    tracker.track("input_completed", inputCompleted);
    tracker.track("mode_switched", { from_mode: "fair", to_mode: "fast", favor_used: false });
    expect(capture).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(capture).toHaveBeenCalledTimes(2));
    expect(loadPostHog).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledTimes(1);
    expect(init.mock.calls[0]?.[0]).toBe(config.key);
    expect(capture.mock.calls[0]).toEqual([
      "input_completed",
      { ...inputCompleted, platform: "web", app_version: "abc1234" },
    ]);
    expect(capture.mock.calls[1]?.[0]).toBe("mode_switched");

    tracker.track("input_completed", inputCompleted); // 불러온 뒤에는 바로 보낸다
    expect(capture).toHaveBeenCalledTimes(3);
    expect(loadPostHog).toHaveBeenCalledTimes(1);
  });

  it("데이터 버전을 알게 되면 이후 이벤트에 data_version이 붙는다", async () => {
    const { tracker, capture } = setup();
    tracker.track("input_completed", inputCompleted);
    tracker.setDataVersion("20261112.6");
    tracker.track("input_completed", inputCompleted);
    await vi.waitFor(() => expect(capture).toHaveBeenCalledTimes(2));
    expect(capture.mock.calls[0]?.[1]).not.toHaveProperty("data_version");
    expect(capture.mock.calls[1]?.[1]).toMatchObject({ data_version: "20261112.6" });
  });

  it("계약을 어기면(금지 속성) 보내지 않는다", async () => {
    const { tracker, loadPostHog, capture } = setup();
    // @ts-expect-error 계약에 없는 속성
    expect(() => tracker.track("input_completed", { ...inputCompleted, origin_station: "강남" })).toThrow(
      /origin_station/,
    );
    await Promise.resolve();
    expect(loadPostHog).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });

  it("불러오기에 실패해도(광고 차단 등) 던지지 않고, 다시 시도하지 않는다", async () => {
    const loadPostHog = vi.fn(() => Promise.reject(new Error("blocked")));
    const { tracker } = setup({ loadPostHog });
    tracker.track("input_completed", inputCompleted);
    await vi.waitFor(() => expect(tracker.enabled()).toBe(false));
    tracker.track("input_completed", inputCompleted);
    expect(loadPostHog).toHaveBeenCalledTimes(1);
  });
});

describe("posthogOptions(개인정보 설정)", () => {
  const options = posthogOptions(config);

  it("자동 수집·녹화·부가 기능·플래그를 모두 끈다", () => {
    expect(options).toMatchObject({
      api_host: POSTHOG_HOSTS.eu,
      autocapture: false,
      rageclick: false,
      capture_pageview: false,
      capture_pageleave: false,
      capture_dead_clicks: false,
      capture_heatmaps: false,
      capture_exceptions: false,
      capture_performance: false,
      disable_session_recording: true,
      disable_surveys: true,
      disable_product_tours: true,
      disable_conversations: true,
      disable_web_experiments: true,
      disable_external_dependency_loading: true,
      advanced_disable_flags: true,
    });
  });

  it("익명으로 시작하고(identified_only) 쿠키·리퍼러를 저장하지 않으며 DNT를 존중한다", () => {
    expect(options).toMatchObject({
      person_profiles: "identified_only",
      persistence: "localStorage",
      save_referrer: false,
      respect_dnt: true,
      property_denylist: ["$raw_user_agent"],
    });
  });

  it("보내기 직전에 URL의 쿼리를 지운다(before_send)", () => {
    expect(options.before_send).toBe(redactCapture);
  });
});
