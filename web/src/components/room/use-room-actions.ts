"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { roomHashProperty, secondsSinceRoomCreated, track } from "@/lib/analytics";
import { deleteRoom, joinRoom, removeParticipant, updateParticipant, updateRoom } from "@/lib/api/rooms";
import type { ParticipantInput, Room } from "@/lib/api/types";
import { errorPolicy, type RoomAction } from "@/lib/room/action-policy";
import { roomErrorMessage } from "@/lib/room/errors";
import type { KeyTracker } from "@/lib/room/idempotency";
import { keepUntilFrom, type RoomRecord, removeRoomRecord, withoutParticipant } from "@/lib/room/tokens";

const FULL_LOCK_REASON = "정한 예상 인원이 다 차서 잠겨 있어요. 누가 나가면 자동으로 다시 열려요.";

export type RoomActions = {
  /** 이 기기에서 방에 참여한다(친구). 성공하면 받은 토큰을 기기에 저장하고 통계를 보낸다. */
  join: (input: ParticipantInput) => void;
  joinPending: boolean;
  /** 참여가 실패한 이유(화면 문구). 폼이 직접 보인다. */
  joinError: string | null;
  /** 내 항목 고치기. `startEdit`로 폼을 열고, 성공하면 `editing`이 닫힌다. */
  edit: (input: ParticipantInput) => void;
  editing: boolean;
  startEdit: () => void;
  cancelEdit: () => void;
  editPending: boolean;
  editError: string | null;
  /** 내 항목 지우기(나가기). */
  leave: () => void;
  /** 방장: 참여자 내보내기·새 참여 잠금/풀기·방 삭제. */
  kick: (participantId: string) => void;
  lock: (locked: boolean) => void;
  remove: () => void;
  /** 나가기·내보내기·잠금·삭제 중 하나가 진행 중이다. */
  busy: boolean;
  /** 나가기·내보내기·잠금·삭제가 실패한 이유, 또는 잠금을 풀 수 없는 이유. 다음 동작을 시작할 때 지운다. */
  actionError: string | null;
  /** 방·결과·미리보기 쿼리를 이 순서로 무효화한다(캐시를 다시 불러온다). */
  refresh: () => void;
};

/**
 * 방 화면의 쓰기 동작 6개(참여·수정·나가기·내보내기·잠금·삭제)와 그 뒤처리를 한곳에 모은다.
 * 오류를 어떻게 다룰지(다시 불러오기·알림)는 `lib/room/action-policy.ts`가 정하고, 이 훅은 그대로 실행만 한다.
 * 성공 뒤처리 순서(기기 기록 → 멱등 키 갱신 → 통계 → 다시 불러오기)는 화면이 쓰던 그대로다.
 *
 * `record`는 이 기기의 방 기록(undefined = 아직 저장소를 읽지 않음), `commit`은 화면 상태와 기기 저장소를 같이 바꾼다.
 */
export function useRoomActions({
  roomId,
  room,
  record,
  commit,
  keys,
}: {
  roomId: string;
  room: Room | undefined;
  record: RoomRecord | null | undefined;
  commit: (next: RoomRecord | null) => void;
  keys: KeyTracker;
}): RoomActions {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const token = record?.participantToken ?? null;
  const participantId = record?.participantId ?? null;
  const hostToken = record?.hostToken;

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["room", roomId] });
    void queryClient.invalidateQueries({ queryKey: ["room-result", roomId] });
    void queryClient.invalidateQueries({ queryKey: ["room-preview", roomId] });
  }, [queryClient, roomId]);

  const onError = (action: RoomAction) => (error: unknown) => {
    const policy = errorPolicy(action, error);
    if (policy.report) setActionError(roomErrorMessage(error));
    if (policy.refresh) refresh();
  };

  const join = useMutation({
    mutationFn: (input: ParticipantInput) => joinRoom(roomId, input, keys.keyFor(input)),
    onSuccess: (joined, input) => {
      commit({
        v: 1,
        ...(record?.hostToken ? { hostToken: record.hostToken } : {}),
        participantToken: joined.participantToken,
        participantId: joined.participantId,
        keepUntil: record?.keepUntil ?? keepUntilFrom(),
        ...(record?.expectedCount ? { expectedCount: record.expectedCount } : {}),
      });
      keys.renew();
      const seconds = secondsSinceRoomCreated(room?.createdAt);
      track("participant_joined", {
        hidden: input.hidden === true,
        ...roomHashProperty({ roomId, roomHash: room?.roomHash }),
        ...(seconds === undefined ? {} : { seconds_since_room_created: seconds }),
      });
      refresh();
    },
    onError: onError("join"),
  });

  const edit = useMutation({
    mutationFn: (input: ParticipantInput) => {
      if (!token || !participantId) throw new Error("no participant");
      return updateParticipant(roomId, participantId, token, input);
    },
    onSuccess: () => {
      setEditing(false);
      refresh();
    },
    onError: onError("edit"),
  });

  const leave = useMutation({
    mutationFn: () => {
      if (!token || !participantId) throw new Error("no participant");
      return removeParticipant(roomId, participantId, token);
    },
    onSuccess: () => {
      if (record) commit(withoutParticipant(record));
      keys.renew();
      setEditing(false);
      refresh();
    },
    onError: onError("leave"),
  });

  const kick = useMutation({
    mutationFn: (id: string) => {
      if (!hostToken) throw new Error("no host token");
      return removeParticipant(roomId, id, hostToken);
    },
    onSuccess: refresh,
    onError: onError("kick"),
  });

  const lock = useMutation({
    mutationFn: (locked: boolean) => {
      if (!hostToken) throw new Error("no host token");
      return updateRoom(roomId, hostToken, { locked });
    },
    // 방장 토큰으로 받은 방 응답에는 "내 항목" 표시(isSelf)가 없다. 캐시에 넣지 않고 내 토큰으로 다시 불러온다.
    onSuccess: (updated, locked) => {
      // 정한 인원이 차서 잠긴 방은 잠금을 풀어도 서버가 계속 잠김으로 답한다(정원 도달도 locked다).
      if (!locked && updated.locked) setActionError(FULL_LOCK_REASON);
      refresh();
    },
    onError: onError("lock"),
  });

  const remove = useMutation({
    mutationFn: () => {
      if (!hostToken) throw new Error("no host token");
      return deleteRoom(roomId, hostToken);
    },
    onSuccess: () => {
      removeRoomRecord(roomId);
      router.push("/");
    },
    onError: onError("remove"),
  });

  return {
    join: (input) => join.mutate(input),
    joinPending: join.isPending,
    joinError: join.isError ? roomErrorMessage(join.error) : null,
    edit: (input) => edit.mutate(input),
    editing,
    startEdit: () => {
      setActionError(null);
      edit.reset();
      setEditing(true);
    },
    cancelEdit: () => setEditing(false),
    editPending: edit.isPending,
    editError: edit.isError ? roomErrorMessage(edit.error) : null,
    leave: () => {
      setActionError(null);
      leave.mutate();
    },
    kick: (id) => {
      setActionError(null);
      kick.mutate(id);
    },
    lock: (locked) => {
      setActionError(null);
      lock.mutate(locked);
    },
    remove: () => {
      setActionError(null);
      remove.mutate();
    },
    busy: leave.isPending || kick.isPending || lock.isPending || remove.isPending,
    actionError,
    refresh,
  };
}
