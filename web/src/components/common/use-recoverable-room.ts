"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useSlowStage } from "@/components/common/use-slow-hint";
import { roomHashProperty, track } from "@/lib/analytics";
import { createDrawRoom, createFilledRoom, deleteRoom } from "@/lib/api/rooms";
import type { Mode, RoomCreated } from "@/lib/api/types";
import type { DrawRoomInput } from "@/lib/room/draw-room";
import { beginDrawRoomAttempt, type DrawRoomAttempt, endDrawRoomAttempt } from "@/lib/room/draw-room-attempt";
import { isDrawRoomUnsupported, isRoomGone } from "@/lib/room/errors";
import { roomPath } from "@/lib/room/id";
import { keepUntilFrom, saveRoomRecord } from "@/lib/room/tokens";

type RecoverableRoomInput = DrawRoomInput & { mode?: Mode; favorPosition?: number };
type Creation = { created: RoomCreated; attemptId: string; input: RecoverableRoomInput };

function persist({ created }: Creation) {
  return saveRoomRecord(created.roomId, {
    hostToken: created.hostToken,
    participantToken: created.participantToken,
    participantId: created.participantId,
    keepUntil: keepUntilFrom(),
  });
}

/** 응답을 잃으면 같은 키로, 기기 저장에 실패하면 받은 자격으로 다시 저장하거나 지운다. */
export function useRecoverableRoom(kind: "draw" | "filled", onEntered?: (input: RecoverableRoomInput) => void) {
  const router = useRouter();
  const [unsaved, setUnsaved] = useState<Creation | null>(null);
  const [saveRetried, setSaveRetried] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [attemptBlocked, setAttemptBlocked] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const submitting = useRef(false);

  const enter = ({ created, attemptId, input }: Creation) => {
    setUnsaved(null);
    endDrawRoomAttempt(attemptId);
    onEntered?.(input);
    track("room_created", {
      hidden_used: false,
      ...roomHashProperty({ roomId: created.roomId, roomHash: created.roomHash }),
    });
    router.push(roomPath(created.roomId));
  };

  const create = useMutation({
    mutationFn: async ({ input, attempt }: { input: RecoverableRoomInput; attempt: DrawRoomAttempt }) => {
      const body = { ...input, recoveryKey: attempt.recoveryKey };
      const created =
        kind === "filled"
          ? await createFilledRoom({ ...body, mode: input.mode ?? "fair" }, attempt.idempotencyKey)
          : await createDrawRoom(body, attempt.idempotencyKey);
      const creation = { created, input, attemptId: attempt.id };
      return { creation, saved: persist(creation) };
    },
    onMutate: () => setRemoved(false),
    onError: (error, { attempt }) => {
      if (kind === "draw" && isDrawRoomUnsupported(error)) endDrawRoomAttempt(attempt.id);
    },
    onSuccess: ({ creation, saved }) => {
      if (saved) enter(creation);
      else setUnsaved(creation);
    },
  });

  const remove = useMutation({
    mutationFn: async ({ created }: Creation) => {
      try {
        await deleteRoom(created.roomId, created.hostToken);
      } catch (error) {
        if (!isRoomGone(error)) throw error;
      }
    },
    onSuccess: (_, { attemptId }) => {
      setUnsaved(null);
      setSaveRetried(false);
      setRemoved(true);
      endDrawRoomAttempt(attemptId);
      create.reset();
    },
  });

  const retrySave = () => {
    if (!unsaved) return;
    if (persist(unsaved)) enter(unsaved);
    else setSaveRetried(true);
  };

  const submit = async (input: RecoverableRoomInput) => {
    if (submitting.current || create.isSuccess) return;
    submitting.current = true;
    setPreparing(true);
    try {
      const attempt = await beginDrawRoomAttempt(input, Date.now(), kind).catch(() => null);
      setAttemptBlocked(attempt === null);
      if (attempt) await create.mutateAsync({ input, attempt }).catch(() => undefined);
    } finally {
      setPreparing(false);
      submitting.current = false;
    }
  };

  return {
    submit,
    pending: preparing || create.isPending,
    submitted: preparing || create.isPending || create.isSuccess,
    stage: useSlowStage(create.isPending),
    error: create.error,
    unsaved: unsaved !== null,
    saveRetried,
    removed,
    attemptBlocked,
    removePending: remove.isPending,
    removeError: remove.error,
    removeCreated: () => {
      if (unsaved) remove.mutate(unsaved);
    },
    retrySave,
  };
}
