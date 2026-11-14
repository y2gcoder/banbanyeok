"use client";

import { useMutation } from "@tanstack/react-query";
import { CheckIcon } from "lucide-react";
import { useId, useState } from "react";
import { StationField } from "@/components/home/station-field";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics";
import { answerOutcome } from "@/lib/api/rooms";
import { daysSince } from "@/lib/room/dates";
import { roomErrorMessage } from "@/lib/room/errors";
import { type OutcomeChoice, toOutcomeAnswer } from "@/lib/room/input";
import type { Station } from "@/lib/stations";
import { cn } from "@/lib/utils";

type Kind = OutcomeChoice["kind"];

const OPTIONS: readonly { kind: Kind; label: string }[] = [
  { kind: "top1", label: "1위 역에서 만났어요" },
  { kind: "top3", label: "2~3위 역에서 만났어요" },
  { kind: "other", label: "다른 역에서 만났어요" },
  { kind: "none", label: "아직 못 정했거나 못 만났어요" },
];

type Props = {
  roomId: string;
  participantToken: string;
  /** 1위 후보 역 코드(통계의 만난 역 코드에만 쓴다. 장소이므로 보내도 된다). */
  topStationCode: string;
  resultSeenAt: string | undefined;
  answered: boolean;
  onAnswered: () => void;
  /** 약속일을 정하지 않은 방은 약속이 끝났는지 모르므로 접어 두고 원할 때 연다. */
  collapsed?: boolean;
};

/** "실제로 어디서 만났나" 한 번의 질문(참여자만). 추천이 실제 약속에 도움이 됐는지 알려 주는 핵심 지표다. */
export function OutcomeCard({
  roomId,
  participantToken,
  topStationCode,
  resultSeenAt,
  answered,
  onAnswered,
  collapsed = false,
}: Props) {
  const id = useId();
  const [kind, setKind] = useState<Kind | null>(null);
  const [station, setStation] = useState<Station | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: async (choice: OutcomeChoice) => {
      const answer = toOutcomeAnswer(choice);
      if (!answer.ok) throw new Error(answer.message);
      await answerOutcome(roomId, participantToken, answer.value);
      return choice;
    },
    onSuccess: (choice) => {
      const meeting =
        choice.kind === "other" ? choice.station?.code : choice.kind === "top1" ? topStationCode : undefined;
      track("outcome_answered", {
        outcome: choice.kind,
        days_since_result: daysSince(resultSeenAt),
        ...(meeting ? { meeting_station_code: meeting } : {}),
      });
      onAnswered();
    },
  });

  if (answered) {
    return (
      <section role="status" className="flex items-center gap-2 rounded-2xl border border-rule bg-surface p-5">
        <CheckIcon className="size-5 shrink-0 text-ink" aria-hidden="true" />
        <p className="text-[15px] font-semibold text-ink">알려 줘서 고마워요. 추천을 더 좋게 만드는 데 써요.</p>
      </section>
    );
  }

  const submit = () => {
    if (!kind) return;
    const choice: OutcomeChoice = kind === "other" ? { kind, station } : { kind };
    const checked = toOutcomeAnswer(choice);
    if (!checked.ok) {
      setProblem(checked.message);
      return;
    }
    setProblem(null);
    send.mutate(choice);
  };

  const form = (
    <>
      <p className="text-[14px] text-ink-soft">약속이 끝난 뒤 한 번만 알려 주세요. 누가 답했는지는 저장하지 않아요.</p>
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">실제로 만난 곳</legend>
        {OPTIONS.map((option) => (
          <label
            key={option.kind}
            className={cn(
              "flex cursor-pointer items-center gap-3 rounded-xl border bg-surface p-3",
              kind === option.kind ? "border-ink ring-1 ring-ink" : "border-rule",
            )}
          >
            <input
              type="radio"
              name={`${id}-outcome`}
              checked={kind === option.kind}
              onChange={() => {
                setKind(option.kind);
                setProblem(null);
              }}
              className="size-4 shrink-0 accent-[var(--ink)]"
            />
            <span className="text-[15px] font-semibold text-ink">{option.label}</span>
          </label>
        ))}
      </fieldset>
      {kind === "other" ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-station`} className="sr-only">
            만난 역
          </label>
          <StationField id={`${id}-station`} value={station} onChange={setStation} />
        </div>
      ) : null}
      {problem || send.isError ? (
        <p role="alert" className="text-sm font-semibold text-destructive">
          {problem ?? roomErrorMessage(send.error)}
        </p>
      ) : null}
      <Button
        type="button"
        onClick={submit}
        disabled={!kind || send.isPending}
        className="h-12 rounded-xl text-[16px] font-bold"
      >
        {send.isPending ? "보내는 중…" : "알려 주기"}
      </Button>
    </>
  );

  if (collapsed) {
    return (
      <section aria-label="실제로 어디서 만났어요?" className="rounded-2xl border border-rule bg-surface p-5">
        <details>
          <summary className="cursor-pointer text-[16px] font-bold text-ink">
            약속이 끝났다면, 어디서 만났는지 알려 주기
          </summary>
          <div className="mt-3 flex flex-col gap-3">{form}</div>
        </details>
      </section>
    );
  }
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-3 rounded-2xl border border-rule bg-surface p-5"
    >
      <h2 id={`${id}-title`} className="text-[18px] font-extrabold text-ink">
        실제로 어디서 만났어요?
      </h2>
      {form}
    </section>
  );
}
