"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { setAnalyticsConsent } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import { CONSENT_COPY } from "./consent-text";
import { useAnalyticsId, useConsentScopes, useConsentState } from "./use-consent";

const STATUS = {
  granted: "모두 동의함 — 이용 통계를 모으고 있어요.",
  denied: "동의하지 않음 — 이용 통계를 모으지 않아요.",
  ask: "아직 고르지 않음 — 이용 통계를 모으지 않아요.",
  "browser-declined": "브라우저의 추적 거부 신호(Do Not Track 또는 Global Privacy Control)가 켜져 있어 모으지 않아요.",
  unavailable: "이 서비스는 지금 이용 통계를 모으지 않아요.",
} as const;

/** 항목 하나의 동의 스위치. 둘 다 켜져야 통계를 모으고, 하나라도 끄면 바로 멈춘다. */
function ScopeSwitch({
  label,
  detail,
  checked,
  disabled,
  onToggle,
}: {
  label: string;
  detail: string;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const labelId = useId();
  const detailId = useId();
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-rule bg-platform/60 p-4">
      <div className="flex min-w-0 flex-col gap-1">
        <span id={labelId} className="font-bold text-ink">
          {label}
        </span>
        <span id={detailId} className="text-[14px] text-ink-soft">
          {detail}
        </span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={detailId}
        disabled={disabled}
        onClick={onToggle}
        className={cn(
          "relative inline-flex h-8 w-14 shrink-0 items-center rounded-full border-2 border-ink transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-40",
          checked ? "bg-ink" : "bg-surface",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "inline-block size-5 rounded-full transition-transform motion-reduce:transition-none",
            checked ? "translate-x-7 bg-surface" : "translate-x-1 bg-ink",
          )}
        />
      </button>
    </div>
  );
}

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
 * /privacy의 통계 설정: 현재 동의 상태와 두 항목(수집·이용, 국외 이전)의 스위치. 둘 다 켜져야 통계를 모은다.
 * 하나라도 끄면(철회) 바로 통계를 멈추고 이 기기에 저장된 통계 식별자를 지운다. 철회는 동의만큼 쉬워야 하므로 한 번 누르면 끝난다.
 */
export function ConsentSettings() {
  const state = useConsentState();
  const scopes = useConsentScopes();
  const statusId = useId();
  const id = useAnalyticsId();
  // 철회하면 이 기기의 식별자가 지워진다. 삭제 요청에 쓸 수 있게 끄기 직전 값을 이 화면에 남겨 둔다(이 화면을 떠나면 사라진다).
  const [clearedId, setClearedId] = useState<string | null>(null);
  const granted = state === "granted";
  const adjustable = state === "granted" || state === "denied" || state === "ask";
  const partial = !granted && (scopes.collect || scopes.transfer) && adjustable;

  const toggle = (key: "collect" | "transfer") => {
    const next = { ...scopes, [key]: !scopes[key] };
    if (granted && !(next.collect && next.transfer)) setClearedId(id);
    else if (next.collect && next.transfer) setClearedId(null);
    setAnalyticsConsent(next);
  };

  return (
    <div className="flex flex-col gap-3">
      <p>
        {CONSENT_COPY.question} {CONSENT_COPY.intro} {CONSENT_COPY.rule}
      </p>
      <p id={statusId} aria-live="polite" className="font-semibold text-ink">
        {state === null
          ? "상태를 확인하는 중이에요."
          : partial
            ? "일부만 동의함 — 두 가지 모두 동의해야 모으므로 지금은 모으지 않아요."
            : STATUS[state]}
      </p>
      <ScopeSwitch
        label="이용 통계 수집·이용 동의"
        detail={CONSENT_COPY.collect.detail}
        checked={scopes.collect}
        disabled={!adjustable}
        onToggle={() => toggle("collect")}
      />
      <ScopeSwitch
        label="통계 정보의 국외 이전 동의(미국, PostHog, Inc.)"
        detail={CONSENT_COPY.transfer.detail}
        checked={scopes.transfer}
        disabled={!adjustable}
        onToggle={() => toggle("transfer")}
      />
      {granted && id ? (
        <IdentifierBox
          id={id}
          heading="이 브라우저의 통계 식별자"
          note="이미 모은 통계의 삭제를 요청할 때 이 값을 알려 주세요. 이 값은 화면에만 보이고 어디로도 보내지 않아요. 하나라도 끄면 이 기기에서 지워지니, 필요하면 먼저 복사해 두세요."
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
        하나라도 끄면 바로 통계를 멈추고, 이 기기에 저장된 통계 식별자를 지워요. 이미 모은 통계는 보유 기간이 지나면
        파기하고, 요청하면 지체 없이 삭제해요(개인정보 처리방침 참고). 동의하지 않아도 서비스는 모두 쓸 수 있어요.
      </p>
    </div>
  );
}
