"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { useOnScreenKeyboardOpen } from "@/components/common/use-on-screen-keyboard";
import { Button } from "@/components/ui/button";
import { setAnalyticsConsent } from "@/lib/analytics";
import { cn } from "@/lib/utils";
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
  const labelId = useId();
  const detailId = useId();
  // 줄 전체가 하나의 라벨이라 어디를 눌러도 체크되고, 누르는 영역은 44px 이상이다.
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-2.5 py-0.5 wide:gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-labelledby={labelId}
        aria-describedby={detailId}
        className="mt-0.5 size-5 shrink-0 accent-ink"
      />
      <span className="flex min-w-0 flex-col">
        <span id={labelId} className="text-[13px] leading-snug font-semibold text-ink wide:text-[14px]">
          {label}
        </span>
        <span id={detailId} className="text-[12px] leading-snug text-ink-soft">
          {detail}
        </span>
      </span>
    </label>
  );
}

/**
 * 처음 방문하면 화면 아래에 뜨는 작은 통계 동의 안내(모든 페이지 공통, 루트 Providers가 붙인다).
 *
 * - 동의는 두 항목(수집·이용, 국외 이전)을 따로 받고 **기본값은 둘 다 해제**다. 둘 다 체크해 저장해야만 통계를 켠다.
 * - 고르기 전에는 미동의다. 통계를 모으지 않고 PostHog도 불러오지 않는다.
 * - 왼쪽 [모두 거부]와 오른쪽 버튼은 같은 크기·같은 모양이다(다크 패턴 금지). 오른쪽 문구는 둘 다 체크했을 때만 "동의하고 닫기",
 *   그 외에는 "이대로 닫기"다(둘 다 체크하지 않은 채 닫으면 거부로 저장된다). 닫기(X)나 "나중에"는 두지 않는다.
 * - 정확히 하나만 체크하면 버튼 위에 "두 가지 모두 체크해야 통계를 모아요."를 알린다(aria-live polite).
 * - 문서 끝에 `sticky bottom-0`으로 둔다: 문서 안(in-flow)에 자기 자리를 차지하므로 맨 아래까지 스크롤하면 어떤 입력·버튼도
 *   배너 뒤에 숨지 않고 닿는다(= 배너 높이만큼의 하단 여백). `fixed`로 바꾸면 이 여백이 사라지니 바꾸지 않는다.
 * - 키가 없는 빌드(통계 꺼짐)나 브라우저 추적 거부(DNT·GPC)에서는 묻지 않는다.
 * - 반응형: 폰에서는 화면을 적게 가린다(390×844에서 약 4분의 1 이하). 안내는 두 문장과 링크 하나, 체크박스는 위아래 한 줄씩(좌우 2칸 금지).
 *   두 칸 폭(wide)부터는 안내와 체크박스를 나란히 둔다. 높이가 짧은 화면(가로로 눕힌 폰)에서도 화면의 60%를 넘게 가리지 않는다
 *   (안내·체크박스는 그 안에서 스크롤, 버튼은 늘 보임). 화면 키보드로 글자를 치는 동안(역 검색 포함)에는 잠시 보이지 않게 해(`invisible` + aria-hidden;
 *   `hidden`이 아니라 자리는 그대로라 높이가 변하지 않는다) 입력 칸과 자동완성 목록을 가리지 않는다(고른 체크 상태는 그대로 남는다).
 */
export function ConsentBanner() {
  const state = useConsentState();
  const titleId = useId();
  const [collect, setCollect] = useState(false);
  const [transfer, setTransfer] = useState(false);
  const typing = useOnScreenKeyboardOpen();
  if (state !== "ask") return null;
  const both = collect && transfer;
  const onlyOne = collect !== transfer;
  return (
    <section
      aria-labelledby={titleId}
      aria-hidden={typing || undefined}
      className={cn(
        typing && "invisible",
        "sticky bottom-0 z-40 mx-auto w-full max-w-md pt-1 pb-2 [padding-bottom:max(0.5rem,env(safe-area-inset-bottom))] [padding-left:max(0.75rem,env(safe-area-inset-left))] [padding-right:max(0.75rem,env(safe-area-inset-right))] wide:max-w-3xl",
      )}
    >
      <div className="flex max-h-[60dvh] flex-col gap-2 rounded-2xl border border-rule-strong bg-surface p-3 shadow-lg wide:gap-3 wide:p-4">
        <div className="scroll-shadow-y -mx-1 flex min-h-0 flex-col gap-1.5 overflow-y-auto px-1 wide:grid wide:grid-cols-2 wide:gap-x-6 wide:gap-y-3">
          <div className="flex flex-col gap-1 wide:row-span-2">
            <h2 id={titleId} className="text-[14px] leading-snug font-bold text-ink wide:text-[15px]">
              {CONSENT_COPY.question}
            </h2>
            <p className="text-[12px] leading-snug text-ink-soft">
              {CONSENT_COPY.intro} {CONSENT_COPY.moreBefore}
              <Link href="/privacy#analytics-settings" className="font-semibold text-ink underline underline-offset-4">
                {CONSENT_COPY.policyLink}
              </Link>
            </p>
          </div>
          <div className="flex flex-col wide:row-span-2">
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
          </div>
        </div>
        <div className="flex shrink-0 flex-col wide:ml-auto wide:w-full wide:max-w-sm">
          {/* 안내 줄 자리는 늘 잡아 둔다: 하나만 체크해도 배너 높이가 변하지 않아 체크박스가 밀리지 않는다. */}
          <div aria-live="polite">
            <p className="min-h-[17px] pb-1 text-[12px] leading-[17px] font-semibold text-ink box-content">
              {onlyOne ? CONSENT_COPY.bothNeeded : null}
            </p>
          </div>
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
              {both ? CONSENT_COPY.closeAgreed : CONSENT_COPY.closeAsIs}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
