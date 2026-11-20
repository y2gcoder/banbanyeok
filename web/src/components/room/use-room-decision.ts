"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { setDecision } from "@/lib/api/rooms";
import { errorPolicy } from "@/lib/room/action-policy";
import { roomErrorMessage } from "@/lib/room/errors";
import { roomKey } from "@/lib/room/queries";

/** 방에서 만날 역 정하기·바꾸기·풀기. 참여한 사람만 쓴다. */
export type DecisionControl = {
  pending: boolean;
  /** 마지막 시도가 실패한 이유(그사이 방이 바뀜 등). 다음 시도에서 지운다. */
  notice: string | null;
  /** `seenVersion`은 그 버튼을 그린 결과의 공유 번호. `onApplied`는 서버가 받았을 때 한 번(통계). */
  decide: (stationCode: string, seenVersion: number, onApplied: () => void) => void;
  /** `seenVersion`은 정한 역을 보여 준 방의 공유 번호. */
  undo: (seenVersion: number) => void;
};

type Attempt = { stationCode: string | null; seenVersion: number; onApplied?: () => void };

/**
 * 서버가 받으면 응답(내 시점의 방)을 방 캐시에 바로 넣어 화면이 깜박이지 않게 하고, 결과·미리보기도 다시 불러온다.
 * 409 `ROOM_CHANGED`(화면이 본 뒤 방이 바뀜)면 다시 불러온 뒤 다시 고르게 안내한다. 자동으로 다시 보내지 않는다.
 */
export function useRoomDecision({
  roomId,
  participantToken,
  participantId,
  refresh,
}: {
  roomId: string;
  participantToken: string | null;
  participantId: string | null;
  refresh: () => void;
}): DecisionControl {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: ({ stationCode, seenVersion }: Attempt) => {
      if (!participantToken) throw new Error("no participant");
      return setDecision(roomId, participantToken, { stationCode, seenVersion });
    },
    onMutate: () => setNotice(null),
    onSuccess: (room, attempt) => {
      queryClient.setQueryData(roomKey(roomId, participantId), room);
      attempt.onApplied?.();
      refresh();
    },
    onError: (error) => {
      const policy = errorPolicy("decide", error);
      if (policy.report) setNotice(roomErrorMessage(error));
      if (policy.refresh) refresh();
    },
  });
  return {
    pending: mutation.isPending,
    notice,
    decide: (stationCode, seenVersion, onApplied) => mutation.mutate({ stationCode, seenVersion, onApplied }),
    undo: (seenVersion) => mutation.mutate({ stationCode: null, seenVersion }),
  };
}
