"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { setAnalyticsConsent } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import { CONSENT_COPY } from "./consent-text";
import { useAnalyticsId, useConsentState } from "./use-consent";

const STATUS = {
  granted: "동의함 — 이용 통계를 모으고 있어요.",
  denied: "동의하지 않음 — 이용 통계를 모으지 않아요.",
  ask: "아직 고르지 않음 — 이용 통계를 모으지 않아요.",
  "browser-declined": "브라우저의 추적 거부 신호(Do Not Track 또는 Global Privacy Control)가 켜져 있어 모으지 않아요.",
  unavailable: "이 서비스는 지금 이용 통계를 모으지 않아요.",
} as const;

/**
 * 삭제 요청에 쓰는 통계 식별자 표시와 복사. 식별자는 이 화면에만 보이고 어디에도 보내지 않는다(복사는 클립보드로만 간다).
 */
function IdentifierBox({ id, heading, note }: { id: string; heading: string; note: string }) {
  const inputId = useId();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
    } catch {
      setCopied(false); // 클립보드를 쓸 수 없으면 아래 칸을 선택해 직접 복사한다.
    }
  };
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-rule p-4">
      <label htmlFor={inputId} className="font-bold text-ink">
        {heading}
      </label>
      <div className="flex gap-2">
        <input
          id={inputId}
          readOnly
          value={id}
          onFocus={(e) => e.currentTarget.select()}
          className="h-11 min-w-0 flex-1 rounded-lg border border-input bg-surface px-3 font-mono text-[13px] text-ink"
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => void copy()}
          className="h-11 rounded-lg px-4 font-semibold"
        >
          {copied ? "복사했어요" : "복사"}
        </Button>
      </div>
      <p aria-live="polite" className="text-[14px]">
        {note}
      </p>
    </div>
  );
}

/**
 * /privacy의 통계 설정: 현재 동의 상태와 바꾸기 스위치. 끄면(철회) 바로 통계를 멈추고 이 기기에 저장된 통계 식별자를 지운다.
 * 철회는 동의만큼 쉬워야 하므로 한 번 누르면 끝나고 확인 단계가 없다.
 */
export function ConsentSettings() {
  const state = useConsentState();
  const labelId = useId();
  const statusId = useId();
  const id = useAnalyticsId();
  // 철회하면 이 기기의 식별자가 지워진다. 삭제 요청에 쓸 수 있게 끄기 직전 값을 이 화면에 남겨 둔다(이 화면을 떠나면 사라진다).
  const [clearedId, setClearedId] = useState<string | null>(null);
  const granted = state === "granted";
  const adjustable = state === "granted" || state === "denied" || state === "ask";
  return (
    <div className="flex flex-col gap-3">
      <p>
        {CONSENT_COPY.question} {CONSENT_COPY.detail}
      </p>
      <div className="flex items-center justify-between gap-4 rounded-xl border border-rule bg-platform/60 p-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span id={labelId} className="font-bold text-ink">
            이용 통계 수집 동의
          </span>
          <span id={statusId} aria-live="polite" className="text-[14px] text-ink-soft">
            {state === null ? "상태를 확인하는 중이에요." : STATUS[state]}
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={granted}
          aria-labelledby={labelId}
          aria-describedby={statusId}
          disabled={!adjustable}
          onClick={() => {
            if (granted) setClearedId(id);
            else setClearedId(null);
            setAnalyticsConsent(!granted);
          }}
          className={cn(
            "relative inline-flex h-8 w-14 shrink-0 items-center rounded-full border-2 border-ink transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-40",
            granted ? "bg-ink" : "bg-surface",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "inline-block size-5 rounded-full transition-transform motion-reduce:transition-none",
              granted ? "translate-x-7 bg-surface" : "translate-x-1 bg-ink",
            )}
          />
        </button>
      </div>
      {granted && id ? (
        <IdentifierBox
          id={id}
          heading="이 브라우저의 통계 식별자"
          note="이미 모은 통계의 삭제를 요청할 때 이 값을 알려 주세요. 이 값은 화면에만 보이고 어디로도 보내지 않아요. 끄면 이 기기에서 지워지니, 필요하면 먼저 복사해 두세요."
        />
      ) : null}
      {!granted && clearedId ? (
        <IdentifierBox
          id={clearedId}
          heading="방금 지운 통계 식별자"
          note="이 기기에서는 지웠어요. 이미 모은 통계의 삭제를 요청하려면 지금 복사해 두세요. 이 화면을 나가면 다시 볼 수 없어요."
        />
      ) : null}
      <p className="text-[14px]">
        끄면 바로 통계를 멈추고, 이 기기에 저장된 통계 식별자를 지워요. 이미 모은 통계는 보유 기간이 지나면 파기하고,
        요청하면 지체 없이 삭제해요(개인정보 처리방침 참고). 동의하지 않아도 서비스는 모두 쓸 수 있어요.
      </p>
    </div>
  );
}
