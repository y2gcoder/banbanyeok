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
