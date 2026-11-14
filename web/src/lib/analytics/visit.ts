/** 브라우저 쪽 보조 판단: 추적 신호 존중, 첫 방문 여부, 유입 경로 분류. 분석이 켜져 있을 때만 호출한다. */
import type { EventProperties } from "./events.gen";

type ReferrerKind = EventProperties["link_opened"]["referrer_kind"];

const SEEN_KEY = "bby.analytics.seen";

const SEARCH_HOSTS = /(^|\.)(google\.[a-z.]+|search\.naver\.com|search\.daum\.net|bing\.com|duckduckgo\.com)$/;
const KAKAO_HOSTS = /(^|\.)kakao(talk)?\.com$/;

/**
 * 유입 경로 분류. 리퍼러 원문은 보내지 않고 이 분류만 보낸다.
 * 카카오톡 인앱 브라우저는 리퍼러가 비는 경우가 많아 사용자 에이전트도 본다.
 */
export function referrerKind(referrer: string, userAgent: string, ownHost: string): ReferrerKind {
  if (/KAKAOTALK/i.test(userAgent)) return "kakao";
  if (!referrer) return "direct";
  let host: string;
  try {
    host = new URL(referrer).hostname;
  } catch {
    return "other";
  }
  if (host === ownHost) return "direct";
  if (KAKAO_HOSTS.test(host)) return "kakao";
  return SEARCH_HOSTS.test(host) ? "search" : "other";
}

/** 브라우저의 추적 거부 신호(Do Not Track, Global Privacy Control). 하나라도 켜져 있으면 분석을 끈다. */
export function trackingDeclined(): boolean {
  if (typeof navigator === "undefined") return true;
  const gpc = (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
  return gpc || navigator.doNotTrack === "1";
}

let firstVisit: boolean | undefined;

/**
 * 이 브라우저의 통계 식별자(PostHog distinct_id). PostHog가 localStorage에 둔 값을 읽을 뿐 SDK를 불러오지 않는다.
 * 개인정보 처리방침의 삭제 요청에 쓰도록 /privacy에서 **화면에만** 보여 준다. 어디에도 보내지 않는다. 없으면 null.
 */
export function readAnalyticsId(): string | null {
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i) ?? "";
      if (!/^ph_.+_posthog$/.test(key)) continue;
      const record: unknown = JSON.parse(window.localStorage.getItem(key) ?? "null");
      const id =
        typeof record === "object" && record !== null ? (record as { distinct_id?: unknown }).distinct_id : null;
      if (typeof id === "string" && id.length > 0) return id;
    }
  } catch {
    // 읽을 수 없으면 보여 줄 것이 없다.
  }
  return null;
}

/**
 * 동의를 철회할 때 이 기기의 통계 식별자를 지운다: PostHog가 만든 `ph_*` 키(익명 ID·SDK 상태·첫 진입 주소)와 첫 방문 표시.
 * PostHog의 옵트아웃 표시(`__ph_opt_in_out_*`)는 식별자가 아니고, 남아 있어야 이미 만든 SDK 객체가 계속 꺼져 있으므로 둔다.
 * 동의 기록(`bby.analytics.consent`)도 남긴다(다시 묻지 않기 위한 선택 기록).
 */
export function clearAnalyticsStorage(): void {
  firstVisit = undefined;
  for (const storage of [window.localStorage, window.sessionStorage]) {
    try {
      const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i) ?? "");
      for (const key of keys) {
        if (/^ph_/.test(key) || key === SEEN_KEY) storage.removeItem(key);
      }
    } catch {
      // 저장소를 쓸 수 없으면 지울 것도 없다.
    }
  }
}

/** 이 기기의 첫 방문인지. 페이지를 불러온 첫 호출에서 정하고 표시를 남긴다(같은 페이지 안에서는 값이 바뀌지 않는다). */
export function isFirstVisit(): boolean {
  if (firstVisit !== undefined) return firstVisit;
  try {
    firstVisit = window.localStorage.getItem(SEEN_KEY) === null;
    window.localStorage.setItem(SEEN_KEY, "1");
  } catch {
    firstVisit = false; // 저장소를 쓸 수 없으면 첫 방문으로 부풀리지 않는다.
  }
  return firstVisit;
}
