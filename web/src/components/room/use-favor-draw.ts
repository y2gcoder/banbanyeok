"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useIdempotencyKey } from "@/components/common/use-idempotency-key";
import { drawFavorTarget, startFavorDraw } from "@/lib/api/rooms";
import { roomErrorMessage } from "@/lib/room/errors";

export type FavorDrawControl = {
  /** 요청이 가는 중이거나, 받은 뒤 방을 다시 불러오는 중. */
  pending: boolean;
  /** 마지막 시도가 실패한 이유. 다음 시도에서 지운다. */
  error: string | null;
  /** 이 기기가 마지막으로 뽑은 뽑기(`RoomDraw.key`). 그 그림이 시작되면 초점을 옮긴다. */
  drewKey: string | null;
  draw: (generation: number, round: number) => void;
  start: (seenVersion: number) => void;
  started: boolean;
};

/**
 * 방장의 '누구 쪽으로' 뽑기(#172). 멱등은 서버가 세대·회차로 한다(같은 회차의 재시도는 바꾸지 않는다).
 * 응답은 토큰 없는 시점의 방이라(`isSelf` 없음) 캐시에 넣지 않고, 방·결과·미리보기를 다시 불러온 뒤에 끝난다(그사이 버튼이 다시 켜지지 않게).
 * 실패하면(그사이 방이 바뀜, 다시 뽑기를 이미 씀 등) 안내하고 다시 불러온다. 자동으로 다시 보내지 않는다.
 */
export function useFavorDraw({
  roomId,
  hostToken,
}: {
  roomId: string;
  hostToken: string | null | undefined;
}): FavorDrawControl {
  const queryClient = useQueryClient();
  const keys = useIdempotencyKey();
  const [error, setError] = useState<string | null>(null);
  const [drewKey, setDrewKey] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const reload = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["room", roomId] }),
      queryClient.invalidateQueries({ queryKey: ["room-result", roomId] }),
      queryClient.invalidateQueries({ queryKey: ["room-preview", roomId] }),
    ]);
  const mutation = useMutation({
    mutationFn: (request: { generation: number; round: number } | { seenVersion: number }) => {
      if (!hostToken) throw new Error("no host token");
      if ("seenVersion" in request) return startFavorDraw(roomId, hostToken, request.seenVersion);
      const { generation, round } = request;
      return drawFavorTarget(roomId, hostToken, generation, round, keys.keyFor(request));
    },
    onMutate: () => setError(null),
    onSuccess: async (_room, request) => {
      if ("seenVersion" in request) setStarted(true);
      else {
        keys.renew();
        setDrewKey(`${request.generation}:${request.round}`);
      }
      await reload();
    },
    onError: (failure) => {
      setError(roomErrorMessage(failure));
      void reload();
    },
  });
  return {
    pending: mutation.isPending,
    error,
    drewKey,
    started,
    start: (seenVersion) => mutation.mutate({ seenVersion }),
    draw: (generation, round) => mutation.mutate({ generation, round }),
  };
}
