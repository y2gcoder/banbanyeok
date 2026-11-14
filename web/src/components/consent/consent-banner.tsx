"use client";

import Link from "next/link";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { setAnalyticsConsent } from "@/lib/analytics";
import { CONSENT_COPY } from "./consent-text";
import { useConsentState } from "./use-consent";

/**
 * 처음 방문하면 화면 아래에 뜨는 작은 통계 동의 안내(모든 페이지 공통, 루트 Providers가 붙인다).
 *
 * - 고르기 전에는 미동의다. 통계를 모으지 않고 PostHog도 불러오지 않는다.
 * - [동의]와 [거부]는 같은 크기·같은 모양이다(다크 패턴 금지). 닫기(X)나 "나중에"는 두지 않는다.
 * - 문서 끝에 `sticky bottom-0`으로 둔다: 스크롤 중에는 아래에 붙어 있고, 맨 아래에서는 본문을 가리지 않고 제자리에 놓인다.
 * - 키가 없는 빌드(통계 꺼짐)나 브라우저 추적 거부(DNT·GPC)에서는 묻지 않는다.
 */
export function ConsentBanner() {
  const state = useConsentState();
  const titleId = useId();
  if (state !== "ask") return null;
  return (
    <section
      aria-labelledby={titleId}
      className="sticky bottom-0 z-40 mx-auto w-full max-w-md px-3 pt-2 pb-3 [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))]"
    >
      <div className="flex flex-col gap-3 rounded-2xl border border-rule-strong bg-surface p-4 shadow-lg">
        <div className="flex flex-col gap-1">
          <h2 id={titleId} className="text-[15px] leading-snug font-bold text-ink">
            {CONSENT_COPY.question}
          </h2>
          <p className="text-[13px] leading-relaxed text-ink-soft">
            {CONSENT_COPY.detail}{" "}
            <Link href="/privacy" className="font-semibold text-ink underline underline-offset-4">
              개인정보 처리방침
            </Link>
            에서 자세히 볼 수 있어요. {CONSENT_COPY.later}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setAnalyticsConsent(false)}
            className="h-11 rounded-lg text-[15px] font-bold"
          >
            {CONSENT_COPY.reject}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setAnalyticsConsent(true)}
            className="h-11 rounded-lg text-[15px] font-bold"
          >
            {CONSENT_COPY.accept}
          </Button>
        </div>
      </div>
    </section>
  );
}
