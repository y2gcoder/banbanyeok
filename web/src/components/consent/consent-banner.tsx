"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { setAnalyticsConsent } from "@/lib/analytics";
import { CONSENT_COPY } from "./consent-text";
import { useConsentState } from "./use-consent";

function ScopeCheckbox({
  label,
  detail,
  checked,
  onChange,
}: {
  label: string;
  detail: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  const detailId = useId();
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-describedby={detailId}
        className="mt-0.5 size-5 shrink-0 accent-ink"
      />
      <div className="flex min-w-0 flex-col">
        <label htmlFor={id} className="text-[14px] leading-snug font-semibold text-ink">
          {label}
        </label>
        <p id={detailId} className="text-[12px] leading-snug text-ink-soft">
          {detail}
        </p>
      </div>
    </div>
  );
}

/**
 * 처음 방문하면 화면 아래에 뜨는 작은 통계 동의 안내(모든 페이지 공통, 루트 Providers가 붙인다).
 *
 * - 동의는 두 항목(수집·이용, 국외 이전)을 따로 받고 **기본값은 둘 다 해제**다. 둘 다 체크해 저장해야만 통계를 켠다.
 * - 고르기 전에는 미동의다. 통계를 모으지 않고 PostHog도 불러오지 않는다.
 * - [선택한 대로 저장]과 [모두 거부]는 같은 크기·같은 모양이다(다크 패턴 금지). 닫기(X)나 "나중에"는 두지 않는다.
 * - 문서 끝에 `sticky bottom-0`으로 둔다: 스크롤 중에는 아래에 붙어 있고, 맨 아래에서는 본문을 가리지 않고 제자리에 놓인다.
 * - 키가 없는 빌드(통계 꺼짐)나 브라우저 추적 거부(DNT·GPC)에서는 묻지 않는다.
 */
export function ConsentBanner() {
  const state = useConsentState();
  const titleId = useId();
  const [collect, setCollect] = useState(false);
  const [transfer, setTransfer] = useState(false);
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
          <p className="text-[12px] leading-snug text-ink-soft">
            {CONSENT_COPY.intro} {CONSENT_COPY.rule}{" "}
            <Link href="/privacy" className="font-semibold text-ink underline underline-offset-4">
              개인정보 처리방침
            </Link>
            에서 자세히 볼 수 있어요. {CONSENT_COPY.later}
          </p>
        </div>
        <ScopeCheckbox
          label={CONSENT_COPY.collect.label}
          detail={CONSENT_COPY.collect.detail}
          checked={collect}
          onChange={setCollect}
        />
        <ScopeCheckbox
          label={CONSENT_COPY.transfer.label}
          detail={CONSENT_COPY.transfer.detail}
          checked={transfer}
          onChange={setTransfer}
        />
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setAnalyticsConsent({ collect: false, transfer: false })}
            className="h-11 rounded-lg text-[15px] font-bold"
          >
            {CONSENT_COPY.rejectAll}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setAnalyticsConsent({ collect, transfer })}
            className="h-11 rounded-lg text-[15px] font-bold"
          >
            {CONSENT_COPY.save}
          </Button>
        </div>
      </div>
    </section>
  );
}
