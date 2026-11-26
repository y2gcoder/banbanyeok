"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useState } from "react";
import { useOnScreenKeyboardOpen } from "@/components/common/use-on-screen-keyboard";
import { Button } from "@/components/ui/button";
import { setAnalyticsConsent } from "@/lib/analytics";
import { parenSafe } from "@/lib/text/paren-safe";
import { cn } from "@/lib/utils";
import { ConsentNotice } from "./consent-notice";
import { CONSENT_COPY } from "./consent-text";
import { useConsentState } from "./use-consent";

/** 통계 설정 카드가 있는 화면. 배너의 "통계 설정" 링크(`/privacy#analytics-settings`)가 여기로 온다. */
const ANALYTICS_SETTINGS_PATH = "/privacy";

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
          {parenSafe(label)}
        </span>
        <span id={detailId} className="text-[12px] leading-snug text-ink-soft">
          {parenSafe(detail)}
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
 * - 정확히 하나만 체크하면 버튼 위에 "두 가지 모두 체크해야 PostHog 통계를 모아요."를 알린다(aria-live polite).
 * - 문서 끝에 `sticky bottom-0`으로 둔다: 문서 안(in-flow)에 자기 자리를 차지하므로 맨 아래까지 스크롤하면 어떤 입력·버튼도
 *   배너 뒤에 숨지 않고 닿는다(= 배너 높이만큼의 하단 여백). `fixed`로 바꾸면 이 여백이 사라지니 바꾸지 않는다.
 * - 키가 없는 빌드(통계 꺼짐)나 브라우저 추적 거부(DNT·GPC)에서는 묻지 않는다. /privacy에서도 띄우지 않는다(같은 동의를 고르는 '통계 설정' 카드가 있다).
 * - 정보 위계(#114): 질문(무엇을 왜) → 안심할 사실 두 줄(통계에 출발역·이름 없음, 거부해도 모든 기능) → 항목별 체크박스와 요약
 *   (국외 이전받는 자·국가·시기·방법·목적·보유 기간은 접지 않고 늘 보인다) → 연령·'자세히 보기'·변경 링크. 화면 순서와 Tab 순서가 같다.
 * - 세부 고지(#116): '자세히 보기'를 한 번 누르면 같은 자리(연령 줄 아래)에 법정 고지 사항 전부([ConsentNotice]: 항목 전체, 이전받는 자의
 *   연락처 등)가 펼쳐진다. 다른 화면으로 가지 않으므로 고른 체크는 그대로이고, 펼쳐도 안내만 배너 안에서 스크롤되고 버튼은 늘 보인다.
 * - 반응형: 폰에서는 화면을 적게 가린다(390×844에서 35% 이하). 체크박스는 위아래 한 줄씩(좌우 2칸 금지).
 *   두 칸 폭(wide)부터는 안내와 체크박스를 나란히 둔다. 높이가 짧은 화면(가로로 눕힌 폰)에서도 화면의 60%를 넘게 가리지 않는다
 *   (안내·체크박스는 그 안에서 스크롤, 버튼은 늘 보임). 화면 키보드로 글자를 치는 동안(역 검색 포함)에는 잠시 보이지 않게 해(`invisible` + aria-hidden;
 *   `hidden`이 아니라 자리는 그대로라 높이가 변하지 않는다) 입력 칸과 자동완성 목록을 가리지 않는다(고른 체크 상태는 그대로 남는다).
 */
export function ConsentBanner() {
  const state = useConsentState();
  const titleId = useId();
  const [collect, setCollect] = useState(false);
  const [transfer, setTransfer] = useState(false);
  const [details, setDetails] = useState(false);
  const noticeId = useId();
  const typing = useOnScreenKeyboardOpen();
  // /privacy에는 같은 두 동의를 고르는 '통계 설정' 카드가 있다. 같은 화면에 같은 동의 UI가 둘이면 헷갈리고 배너가 카드를 덮으므로 여기서는 띄우지 않는다.
  const pathname = usePathname();
  if (state !== "ask" || pathname === ANALYTICS_SETTINGS_PATH) return null;
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
      <div className="flex max-h-[60dvh] flex-col gap-1 rounded-2xl border border-rule-strong bg-surface px-3 py-2 shadow-lg wide:gap-3 wide:p-4">
        <div className="scroll-shadow-y -mx-1 flex min-h-0 flex-col gap-1 overflow-y-auto px-1 wide:grid wide:grid-cols-2 wide:gap-x-6 wide:gap-y-3">
          <div className="flex flex-col gap-1 wide:row-span-2">
            <h2 id={titleId} className="text-[14px] leading-snug font-bold text-ink wide:text-[15px]">
              {parenSafe(CONSENT_COPY.question)}
            </h2>
            {/* 안심할 사실 두 줄은 세부 고지보다 먼저, 조금 더 진하게 둔다(정보 위계: 왜·무엇 → 거절해도 다 쓸 수 있음 → 세부). */}
            <ul className="flex flex-col gap-0.5 text-[12.5px] leading-snug text-ink">
              {CONSENT_COPY.reassure.map((line) => (
                <li key={line} className="flex gap-1.5">
                  <span aria-hidden="true" className="shrink-0 font-bold">
                    ✓
                  </span>
                  <span>{parenSafe(line)}</span>
                </li>
              ))}
            </ul>
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
            {/* 연령·자세히 줄은 요약 뒤(버튼 바로 위)에 둔다. 화면 순서와 Tab 순서가 같다(체크박스 → 자세히 → 링크 → 버튼). */}
            {/* 스크롤 칸의 마지막 줄이라 밑줄이 잘리지 않게 아래로 2px 여유를 두고 밑줄을 조금 올린다. */}
            <p className="pb-0.5 text-[12px] leading-snug text-ink-soft">
              {parenSafe(CONSENT_COPY.age)}{" "}
              {/* 문장 안의 단추라 옆 링크처럼 글자 크기 그대로 둔다(WCAG 2.5.8의 '문장 안' 예외, e2e/support/layout.ts). */}
              <button
                type="button"
                aria-expanded={details}
                aria-controls={noticeId}
                onClick={() => setDetails((open) => !open)}
                className="cursor-pointer rounded-sm font-semibold text-ink underline underline-offset-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {CONSENT_COPY.detailsToggle}
                <span aria-hidden="true" className="ml-0.5 inline-block no-underline">
                  {details ? "▴" : "▾"}
                </span>
              </button>
              <span aria-hidden="true"> · </span>
              <Link href="/privacy#analytics-settings" className="font-semibold text-ink underline underline-offset-2">
                {CONSENT_COPY.policyLink}
              </Link>
            </p>
          </div>
          <div hidden={!details} className="border-t border-rule pt-2 wide:col-span-2">
            <ConsentNotice id={noticeId} compact />
          </div>
        </div>
        <div className="flex shrink-0 flex-col wide:ml-auto wide:w-full wide:max-w-sm">
          {/* 안내 줄 자리는 늘 잡아 둔다: 하나만 체크해도 배너 높이가 변하지 않아 체크박스가 밀리지 않는다. */}
          <div aria-live="polite">
            <p className="min-h-[17px] text-[12px] leading-[17px] font-semibold text-ink box-content">
              {onlyOne ? parenSafe(CONSENT_COPY.bothNeeded) : null}
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
