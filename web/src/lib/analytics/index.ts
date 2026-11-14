/**
 * 사용 통계(PostHog) 진입점. 이벤트 이름·속성은 contracts/events.json이 원천이고, 타입은 events.gen.ts가 강제한다.
 *
 * 키(NEXT_PUBLIC_POSTHOG_KEY)가 없으면 아무것도 하지 않는다. 출발역·별칭·방 ID는 어떤 속성에도 넣지 않는다(타입이 막는다).
 * 설계와 개인정보 설정은 docs/setup/p7-notes.md.
 */

import { maxMinutesBucket, responseTimeBucket } from "./buckets";
import { appVersion, publicAnalyticsConfig } from "./config";
import { type ConsentState, consentState, readChoice, subscribeConsent, writeChoice } from "./consent";
import type { EventProperties } from "./events.gen";
import { createTracker, type PostHogClient } from "./tracker";
import { clearAnalyticsStorage, isFirstVisit, readAnalyticsId, referrerKind, trackingDeclined } from "./visit";

const READY = "bby:analytics-ready";

const config = publicAnalyticsConfig();

const tracker = createTracker({
  config,
  appVersion: appVersion(),
  declined: trackingDeclined,
  consented: () => readChoice() === "granted",
  clearStorage: clearAnalyticsStorage,
  onReady: () => window.dispatchEvent(new Event(READY)),
  // `no-external`: 녹화·설문·원격 스크립트를 내려받지 않는 빌드. 첫 이벤트 때 따로 불러온다.
  loadPostHog: async () => (await import("posthog-js/no-external")).default as PostHogClient,
});

// 동의 상태가 바뀌면(이 탭의 버튼·다른 탭) 철회를 즉시 반영한다. 동의로 바뀌는 쪽은 다음 이벤트에서 알아서 켜진다.
if (typeof window !== "undefined") {
  subscribeConsent(() => {
    if (readChoice() !== "granted") tracker.revoke();
  });
}

/** 이 빌드가 통계를 모으는 설정인지(키·호스트가 있음). 아니면 동의를 묻지 않는다. */
const analyticsAvailable = config !== null;

/** 화면용 동의 상태. 브라우저에서만 의미가 있다(서버 렌더링에서는 부르지 않는다). */
export function currentConsentState(): ConsentState {
  return consentState(analyticsAvailable, trackingDeclined());
}

export { subscribeConsent };

/** 이 브라우저의 통계 식별자(화면 표시 전용, 어디에도 보내지 않는다). 없으면 null. */
export const currentAnalyticsId = readAnalyticsId;

/** 동의 상태나 식별자가 바뀔 때 알린다(식별자는 PostHog 초기화 직후에 생긴다). */
export function subscribeAnalytics(onChange: () => void): () => void {
  const off = subscribeConsent(onChange);
  window.addEventListener(READY, onChange);
  return () => {
    off();
    window.removeEventListener(READY, onChange);
  };
}

/**
 * 이벤트를 보낸다(꺼져 있으면 아무것도 하지 않는다). 켜져 있으면 이 기기의 "첫 방문" 표시를 이 페이지의 첫 이벤트에서 정해 둔다:
 * 이후 같은 기기의 다른 페이지 로드는 첫 방문이 아니다.
 */
export const track: typeof tracker.track = (name, properties) => {
  if (tracker.enabled()) isFirstVisit();
  tracker.track(name, properties);
};

/**
 * 동의하거나(true) 거부·철회한다(false). 거부·철회는 저장 즉시 PostHog를 끄고 저장된 식별자를 지운다.
 * 동의하면 `analytics_consent_changed`를 한 번 보낸다(동의한 사실의 기록). 철회는 보내지 않는다: 철회한 뒤에는 수집하지 않는다.
 */
export function setAnalyticsConsent(granted: boolean): void {
  writeChoice(granted ? "granted" : "denied");
  if (granted) track("analytics_consent_changed", { granted: true });
}

type Mode = EventProperties["mode_switched"]["from_mode"];

export type ResultViewedInput = {
  participantCount: number;
  mode: Mode;
  /** 1위 후보의 최장 소요시간(표시 분). 후보가 없으면 없다. */
  topMaxMinutes: number | undefined;
  candidateCount: number;
  /** 1위 만날 역 코드(장소이므로 허용). */
  topStationCode: string | undefined;
  dataVersion: string;
  /** 이 화면을 위해 서버를 실제로 부른 시간(밀리초). 캐시에서 바로 보였다면 없다. */
  responseMs: number | undefined;
};

/** 추천 결과 표시. 모드·후보 수·서버 응답 시간 구간만 보낸다. */
export function trackResultViewed(input: ResultViewedInput): void {
  tracker.setDataVersion(input.dataVersion);
  const properties: EventProperties["result_viewed"] = {
    participant_count: input.participantCount,
    mode: input.mode,
    candidate_count: input.candidateCount,
  };
  if (input.topMaxMinutes !== undefined) properties.max_minutes_bucket = maxMinutesBucket(input.topMaxMinutes);
  if (input.responseMs !== undefined) properties.response_time_bucket = responseTimeBucket(input.responseMs);
  if (input.topStationCode) properties.top1_station_code = input.topStationCode;
  track("result_viewed", properties);
}

/** 받은 링크 열림. 첫 방문 여부와 유입 경로 분류만 보낸다(리퍼러 원문은 보내지 않는다). */
export function trackLinkOpened(linkType: EventProperties["link_opened"]["link_type"]): void {
  if (!tracker.enabled()) return; // 꺼져 있으면 첫 방문 표시도 남기지 않는다.
  track("link_opened", {
    link_type: linkType,
    is_first_visit: isFirstVisit(),
    referrer_kind: referrerKind(document.referrer, navigator.userAgent, window.location.hostname),
  });
}
