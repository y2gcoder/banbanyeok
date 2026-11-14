"use client";

import { useSyncExternalStore } from "react";
import { currentAnalyticsId, currentConsentState, subscribeAnalytics, subscribeConsent } from "@/lib/analytics";
import type { ConsentState } from "@/lib/analytics/consent";

/**
 * 동의 상태를 구독한다. 서버 렌더링과 수화 첫 렌더에서는 `null`(아직 모름)이라 배너·설정이 깜빡이거나 수화가 어긋나지 않는다.
 */
export function useConsentState(): ConsentState | null {
  return useSyncExternalStore<ConsentState | null>(subscribeConsent, currentConsentState, () => null);
}

/** 이 브라우저의 통계 식별자(없으면 null). 화면에만 보여 주는 값이다. */
export function useAnalyticsId(): string | null {
  return useSyncExternalStore<string | null>(subscribeAnalytics, currentAnalyticsId, () => null);
}
