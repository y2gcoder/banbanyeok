"use client";

import { personColor } from "@/components/common/person-color";
import { Button } from "@/components/ui/button";
import type { RoomPerson } from "@/lib/room/view";
import { ConfirmAction } from "./confirm-action";

type Props = {
  people: readonly RoomPerson[];
  maxPeople: number;
  /** 방장 토큰이 있으면 다른 사람을 내보낼 수 있다. */
  canKick: boolean;
  editing: boolean;
  busy: boolean;
  onEditSelf: () => void;
  onRemoveSelf: () => void;
  onKick: (participantId: string) => void;
};

/**
 * 현재 참여자 목록(노선도처럼 사람마다 색 점). 이름은 서버 label 그대로이고 본인 줄에만 "(나)"를 붙인다.
 * 출발역을 가린 사람은 "출발역 비공개"로 보인다(본인에게만 자기 출발역이 보인다).
 */
export function PeopleList({ people, maxPeople, canKick, editing, busy, onEditSelf, onRemoveSelf, onKick }: Props) {
  return (
    <section
      aria-labelledby="people-title"
      className="flex flex-col gap-3 rounded-2xl border border-rule bg-surface p-5"
    >
      <div className="flex items-baseline justify-between">
        <h2 id="people-title" className="text-[18px] font-extrabold text-ink">
          들어온 사람
        </h2>
        <p className="tabular text-[15px] font-semibold text-ink-soft">
          {people.length}/{maxPeople}명
        </p>
      </div>
      <ol className="flex flex-col gap-3">
        {people.map((person, index) => (
          <li key={person.id} className="flex items-start gap-3">
            <span aria-hidden="true" className="flex w-5 shrink-0 justify-center pt-[3px]">
              <span
                className="size-5 rounded-full border-[5px] bg-surface"
                style={{ borderColor: personColor(index) }}
              />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className="flex flex-wrap items-center gap-x-1.5 text-[16px] font-bold text-ink">
                <span className="truncate">{person.name}</span>
                {person.isSelf ? <span className="text-xs font-semibold text-muted-foreground">(나)</span> : null}
                {person.isHost ? (
                  <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[11px] font-bold text-ink-soft">방장</span>
                ) : null}
              </p>
              <p className="text-[14px] text-muted-foreground">{person.originText}</p>
              {person.isSelf && !editing ? (
                <div className="-ml-3 flex flex-wrap items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label="수정 내 항목"
                    onClick={onEditSelf}
                    className="h-9 px-3 text-[14px] font-semibold"
                  >
                    수정
                  </Button>
                  <ConfirmAction
                    label="삭제"
                    target="내 항목"
                    question="내 항목을 지울까요?"
                    confirmLabel="지우기"
                    tone="danger"
                    pending={busy}
                    onConfirm={onRemoveSelf}
                  />
                </div>
              ) : null}
              {canKick && !person.isSelf ? (
                <div className="-ml-3">
                  <ConfirmAction
                    label="내보내기"
                    target={person.name}
                    question={`${person.name}님을 내보낼까요?`}
                    confirmLabel="내보내기"
                    tone="danger"
                    pending={busy}
                    onConfirm={() => onKick(person.id)}
                  />
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
