"use client";

import { type FormEvent, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ParticipantInput, Room } from "@/lib/api/types";
import { type ParticipantFormValue, toParticipantInput } from "@/lib/room/input";
import { ParticipantFields } from "./participant-fields";
import { slowMessage, useSlowStage } from "./use-slow-hint";

type Props = {
  mode: "join" | "edit";
  initial: ParticipantFormValue;
  personIndex: number;
  pending: boolean;
  /** 서버가 보낸 오류를 화면 문구로 바꾼 것. */
  error: string | null;
  onSubmit: (input: ParticipantInput, value: ParticipantFormValue) => void;
  onCancel?: () => void;
  onEdited?: () => void;
  /** 방의 계산 기준(서버가 준 `timeBasis`). 없으면(옛 서버) 문구를 그리지 않는다. 화면은 라벨을 다시 만들지 않는다. */
  timeBasis?: Room["timeBasis"];
};

/** 방에 참여하거나(친구) 내 항목을 고치는(참여자) 폼. */
export function JoinForm({
  mode,
  initial,
  personIndex,
  pending,
  error,
  onSubmit,
  onCancel,
  onEdited,
  timeBasis,
}: Props) {
  const id = useId();
  const [value, setValue] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const stage = useSlowStage(pending);
  const joining = mode === "join";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const checked = toParticipantInput(value);
    if (!checked.ok) {
      setProblem(checked.message);
      return;
    }
    setProblem(null);
    onSubmit(checked.value, value);
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-4 rounded-2xl border border-rule bg-surface p-5"
    >
      <h2 id={`${id}-title`} className="text-[18px] font-extrabold text-ink">
        {joining ? "나도 출발역 넣기" : "내 출발역 고치기"}
      </h2>
      <ParticipantFields
        idPrefix={id}
        value={value}
        onChange={(next) => {
          setProblem(null);
          onEdited?.();
          setValue(next);
        }}
        personIndex={personIndex}
      />
      {timeBasis ? (
        <p id={`${id}-basis`} role="status" className="text-[14px] font-semibold text-ink">
          {timeBasis.label}
          {timeBasis.holidayName ? `(${timeBasis.holidayName})` : ""} 기준으로 계산해요
        </p>
      ) : null}
      {problem || error ? (
        <p role="alert" className="text-sm font-semibold text-destructive">
          {problem ?? error}
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        <Button type="submit" disabled={pending || !value.station} className="h-14 rounded-xl text-[17px] font-bold">
          {pending ? (joining ? "참여하는 중…" : "저장하는 중…") : joining ? "참여하기" : "저장하기"}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={pending} className="h-11 text-[15px]">
            취소
          </Button>
        ) : null}
      </div>
      {pending && stage > 0 ? (
        <p role="status" className="text-[13px] text-ink-soft">
          {slowMessage(stage, joining ? "참여하기" : "저장하기")}
        </p>
      ) : null}
    </form>
  );
}
