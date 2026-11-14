"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

type Props = {
  /** 처음 보이는 버튼 글자("삭제"). */
  label: string;
  /** 스크린리더용 대상("내 항목"). 버튼 이름은 "{label} {target}"이 된다. */
  target: string;
  question: string;
  confirmLabel: string;
  pending?: boolean;
  onConfirm: () => void;
  tone?: "default" | "danger";
};

/** 되돌릴 수 없는 동작은 한 번 더 확인한다(대화상자 대신 그 자리에서 두 단계). */
export function ConfirmAction({
  label,
  target,
  question,
  confirmLabel,
  pending = false,
  onConfirm,
  tone = "default",
}: Props) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <Button
        type="button"
        variant="ghost"
        aria-label={`${label} ${target}`}
        onClick={() => setAsking(true)}
        className={
          tone === "danger"
            ? "h-11 px-3 text-[14px] font-semibold text-destructive"
            : "h-11 px-3 text-[14px] font-semibold"
        }
      >
        {label}
      </Button>
    );
  }
  return (
    <fieldset className="flex min-w-0 flex-wrap items-center gap-2">
      <legend className="sr-only">
        {target} {label} 확인
      </legend>
      <span className="text-[14px] text-ink">{question}</span>
      <Button
        type="button"
        variant="destructive"
        disabled={pending}
        onClick={() => {
          onConfirm();
          setAsking(false);
        }}
        className="h-11 px-3 text-[14px] font-bold"
      >
        {confirmLabel}
      </Button>
      <Button type="button" variant="ghost" onClick={() => setAsking(false)} className="h-11 px-3 text-[14px]">
        취소
      </Button>
    </fieldset>
  );
}
