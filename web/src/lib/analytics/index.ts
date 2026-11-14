/**
 * 사용 통계(PostHog) 진입점. 이벤트 이름·속성은 contracts/events.json이 원천이고, 타입은 events.gen.ts가 강제한다.
 *
 * 키(NEXT_PUBLIC_POSTHOG_KEY)가 없으면 아무것도 하지 않는다. 출발역·별칭·방 ID는 어떤 속성에도 넣지 않는다(타입이 막는다).
 * 설계와 개인정보 설정은 docs/setup/p7-notes.md.
 */

import { maxMinutesBucket, responseTimeBucket } from "./buckets";
import { appVersion, publicAnalyticsConfig } from "./config";
import type { EventProperties } from "./events.gen";
import { createTracker, type PostHogClient } from "./tracker";
import { isFirstVisit, referrerKind, trackingDeclined } from "./visit";

const tracker = createTracker({
  config: publicAnalyticsConfig(),
  appVersion: appVersion(),
  declined: trackingDeclined,
  // `no-external`: 녹화·설문·원격 스크립트를 내려받지 않는 빌드. 첫 이벤트 때 따로 불러온다.
  loadPostHog: async () => (await import("posthog-js/no-external")).default as PostHogClient,
});

/**
 * 이벤트를 보낸다(꺼져 있으면 아무것도 하지 않는다). 켜져 있으면 이 기기의 "첫 방문" 표시를 이 페이지의 첫 이벤트에서 정해 둔다:
 * 이후 같은 기기의 다른 페이지 로드는 첫 방문이 아니다.
 */
export const track: typeof tracker.track = (name, properties) => {
  if (tracker.enabled()) isFirstVisit();
  tracker.track(name, properties);
};

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
