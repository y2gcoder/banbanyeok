"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { useOnScreenKeyboardOpen } from "@/components/common/use-on-screen-keyboard";
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
    <div className="flex items-start gap-2.5 wide:gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-describedby={detailId}
        className="mt-1 size-5 shrink-0 accent-ink wide:mt-0.5"
      />
      <div className="flex min-w-0 flex-col">
        <label
          htmlFor={id}
          className="min-h-11 py-1.5 text-[13px] leading-snug font-semibold text-ink wide:-my-3.5 wide:min-h-0 wide:py-3.5 wide:text-[14px]"
        >
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
 * - 반응형(U1·U2): 폰에서는 화면을 적게 가린다(390×844에서 약 4분의 1). 안내는 짧게(고지 문장은 그대로), 두 체크박스를 나란히 두고
 *   그 아래 같은 크기의 두 버튼을 한 줄로 둔다. 체크박스 설명(항목·목적·보유 기간·국외 이전)과 철회 안내는 폰에서도
 *   눈에 보인다(구분·국외 이전 동의는 동의 화면에서 중요 내용을 알기 쉽게 보여야 해 링크로 대체하지 않는다). 두 칸 폭(wide)부터는 모두 보이고 안내와 체크박스를 나란히 둔다. 높이가 짧은 화면(가로로 눕힌 폰)에서도
 *   화면의 60%를 넘게 가리지 않는다(안내·체크박스는 그 안에서 스크롤, 버튼은 늘 보임). 배너는 문서 끝의 `sticky`라 맨 아래까지 스크롤하면
 *   본문 아래에 배너 자리가 따로 있어 마지막 줄을 가리지 않는다. 화면 키보드로 글자를 치는 동안에는 잠시 숨겨 입력 칸을 가리지 않는다
 *   (고른 체크 상태는 그대로 남는다).
 */
export function ConsentBanner() {
  const state = useConsentState();
  const titleId = useId();
  const [collect, setCollect] = useState(false);
  const [transfer, setTransfer] = useState(false);
  const typing = useOnScreenKeyboardOpen();
  if (state !== "ask") return null;
  return (
    <section
      aria-labelledby={titleId}
      hidden={typing}
      className="sticky bottom-0 z-40 mx-auto w-full max-w-md pt-2 pb-2 [padding-bottom:max(0.5rem,env(safe-area-inset-bottom))] [padding-left:max(0.75rem,env(safe-area-inset-left))] [padding-right:max(0.75rem,env(safe-area-inset-right))] wide:max-w-3xl"
    >
      <div className="flex max-h-[60dvh] flex-col gap-2.5 rounded-2xl border border-rule-strong bg-surface p-3 shadow-lg wide:gap-3 wide:p-4">
        <div className="scroll-shadow-y -mx-1 flex min-h-0 flex-col gap-2.5 overflow-y-auto px-1 wide:grid wide:grid-cols-2 wide:gap-x-6 wide:gap-y-3">
          <div className="flex flex-col gap-1 wide:row-span-2">
            <h2 id={titleId} className="text-[14px] leading-snug font-bold text-ink wide:text-[15px]">
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
          <div className="grid grid-cols-1 gap-2.5 min-[360px]:grid-cols-2 min-[360px]:gap-x-3 wide:row-span-2 wide:grid-cols-1 wide:gap-3">
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
        <div className="grid shrink-0 grid-cols-2 gap-2 wide:ml-auto wide:w-full wide:max-w-sm">
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
