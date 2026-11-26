"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { useIdempotencyKey } from "@/components/common/use-idempotency-key";
import { slowMessage, useSlowStage } from "@/components/common/use-slow-hint";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { roomHashProperty, track } from "@/lib/analytics";
import { createRoom } from "@/lib/api/rooms";
import type { RoomCreateRequest } from "@/lib/api/types";
import { withJosa } from "@/lib/display/korean";
import type { ShareState } from "@/lib/link/codec";
import { meetingForSlot, toDrawRoomRequest } from "@/lib/room/draw-room";
import { roomErrorMessage } from "@/lib/room/errors";
import { roomPath } from "@/lib/room/id";
import { canStoreRoomTokens, keepUntilFrom, saveRoomRecord } from "@/lib/room/tokens";
import { formatMeetingDay, todayInSeoul } from "@/lib/when/dates";

type Person = { index: number; name: string };

function keepingText(meetingDate: string | null): string {
  return meetingDate
    ? `약속일(${formatMeetingDay(meetingDate)}) 다음 날 방이 사라져요.`
    : "마지막으로 바뀐 뒤 7일이 지나면 방이 사라져요(만든 뒤 최대 30일).";
}

/**
 * 혼자 입력한 결과에서 사다리 방을 만들기 전에 묻는다(#227, ADR-0011). 저장되는 것, 링크를 받은 사람에게 보이는 것, 보관 기간을
 * 실제 규칙대로 알리고 "나"를 고르게 한 뒤에만 방을 만든다. 만든 뒤에는 방으로 가서 방장이 사다리를 탄다.
 */
export function DrawRoomDialog({
  open,
  onOpenChange,
  state,
  people,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: ShareState;
  people: readonly Person[];
}) {
  const router = useRouter();
  const id = useId();
  const keys = useIdempotencyKey();
  const [hostIndex, setHostIndex] = useState(0);
  const [today, setToday] = useState("");
  const [storable, setStorable] = useState(true);
  useEffect(() => {
    if (!open) return;
    setToday(todayInSeoul());
    setStorable(canStoreRoomTokens());
  }, [open]);

  const create = useMutation({
    mutationFn: (body: RoomCreateRequest) => createRoom(body, keys.keyFor(body)),
    onSuccess: (created) => {
      saveRoomRecord(created.roomId, {
        hostToken: created.hostToken,
        participantToken: created.participantToken,
        participantId: created.participantId,
        keepUntil: keepUntilFrom(),
      });
      keys.renew();
      track("room_created", {
        hidden_used: false,
        ...roomHashProperty({ roomId: created.roomId, roomHash: created.roomHash }),
      });
      router.push(roomPath(created.roomId));
    },
  });
  const stage = useSlowStage(create.isPending);
  const meeting = today ? meetingForSlot(state.timeSlot, today, state.slotDefaulted === true) : null;
  const host = people.find((person) => person.index === hostIndex)?.name ?? "";
  const submitted = create.isPending || create.isSuccess;

  const confirm = () => {
    if (!today) return;
    create.mutate(toDrawRoomRequest(state, hostIndex, today));
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !submitted && onOpenChange(next)}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-4 overflow-y-auto rounded-2xl p-5">
        <DialogTitle className="pr-8 text-lg leading-snug font-bold">사다리로 누구 쪽일지 뽑을까요?</DialogTitle>
        <DialogDescription className="text-[15px] leading-relaxed text-ink">
          사다리는 역이 아니라 사람을 뽑아요. 뽑힌 사람이 덜 이동하는 쪽으로 만날 역을 다시 찾고, 다른 사람도 공평
          1위보다 15분(또는 그 시간의 절반) 넘게 더 가지 않아요.
        </DialogDescription>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-[15px] font-bold text-ink">이 중 나는?</legend>
          <div className="flex flex-wrap gap-2">
            {people.map((person) => (
              <label
                key={person.index}
                className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-full border border-rule-strong bg-surface px-4 text-[15px] font-semibold text-ink has-checked:border-ink has-checked:bg-ink has-checked:text-primary-foreground has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ink"
              >
                <input
                  type="radio"
                  name={`${id}-me`}
                  value={person.index}
                  checked={hostIndex === person.index}
                  onChange={() => setHostIndex(person.index)}
                  className="sr-only"
                />
                {person.name}
              </label>
            ))}
          </div>
          <p className="text-[13px] leading-snug text-muted-foreground">
            고른 사람이 방장이 되어 사다리를 타요. 나머지 칸은 '방장이 입력'으로 보여요.
          </p>
        </fieldset>

        <section
          aria-labelledby={`${id}-keep`}
          className="flex flex-col gap-2 rounded-xl border border-rule bg-platform p-3.5"
        >
          <h3 id={`${id}-keep`} className="text-[15px] font-bold text-ink">
            방을 만들어 저장해요
          </h3>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[14px] leading-snug text-ink">
            <li>
              넣은 {people.length}명의 이름(넣은 경우)과 출발역, 약속 요일·시간대가 방에 저장돼요.{" "}
              {keepingText(meeting?.meetingDate ?? null)}{" "}
              {host ? `${withJosa(host, "은/는")} 방장으로 언제든 방을 지울 수 있어요.` : null}
            </li>
            <li>방 링크를 가진 사람은 누구나 이름, 출발역, 각자 걸리는 시간과 사다리 결과를 볼 수 있어요.</li>
            <li>
              다른 사람이 더 들어오지 않게 방을 잠가 둬요. 대신 넣은 칸은 그 사람이 고칠 수 없고, 방장만 뺄 수 있어요.
            </li>
            <li>뽑기는 서버가 정하고 저장해요. 다시 뽑기는 한 번이고 모두에게 보여요.</li>
          </ul>
        </section>

        {storable ? null : (
          <p role="status" className="text-[13px] text-destructive">
            이 브라우저는 저장 공간을 막아 두어서, 방을 만들어도 이 기기에서 사다리를 탈 수 없어요.
          </p>
        )}
        {create.isError ? (
          <p role="alert" className="text-sm font-semibold text-destructive">
            {roomErrorMessage(create.error)}
          </p>
        ) : null}
        <p aria-live="polite" className="text-[13px] text-muted-foreground empty:hidden">
          {create.isPending ? slowMessage(stage, "방 만들기") : null}
        </p>

        <div className="flex flex-col gap-2">
          <Button
            type="button"
            onClick={confirm}
            disabled={submitted || !storable || !today}
            className="h-12 rounded-xl text-base font-bold"
          >
            {submitted ? "방 만드는 중…" : "방 만들고 사다리 타러 가기"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={submitted}
            className="h-11 text-[15px] font-semibold"
          >
            취소
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
