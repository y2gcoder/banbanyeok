"use client";

import { LockIcon, LockOpenIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "./confirm-action";

type Props = {
  locked: boolean;
  busy: boolean;
  error: string | null;
  onToggleLock: (locked: boolean) => void;
  onDeleteRoom: () => void;
};

/** 방장 전용: 새 참여 잠금과 방 삭제(만든 기기에서만 보인다). 참여자 내보내기는 목록에 있다. */
export function HostControls({ locked, busy, error, onToggleLock, onDeleteRoom }: Props) {
  return (
    <section aria-labelledby="host-title" className="flex flex-col gap-3 rounded-2xl border border-rule bg-surface p-5">
      <h2 id="host-title" className="text-[18px] font-extrabold text-ink">
        방장 설정
      </h2>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[14px] text-ink-soft">
          {locked ? "새로 들어오는 것을 막고 있어요." : "링크가 있으면 누구나 들어올 수 있어요."}
        </p>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => onToggleLock(!locked)}
          aria-pressed={locked}
          className="h-10 shrink-0 text-[14px] font-semibold"
        >
          {locked ? <LockOpenIcon aria-hidden="true" /> : <LockIcon aria-hidden="true" />}
          {locked ? "잠금 풀기" : "참여 잠그기"}
        </Button>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-rule pt-3">
        <p className="text-[14px] text-ink-soft">방을 지우면 모든 입력이 바로 사라져요.</p>
        <ConfirmAction
          label="방 삭제"
          target="방 전체"
          question="방을 지울까요?"
          confirmLabel="방 지우기"
          tone="danger"
          pending={busy}
          onConfirm={onDeleteRoom}
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm font-semibold text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
