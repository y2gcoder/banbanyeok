/** 방 화면의 서버 상태(TanStack Query). 토큰은 키에 넣지 않는다(참여자 ID로 구분한다). */
import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { getRoom, getRoomResult } from "@/lib/api/rooms";
import type { Mode } from "@/lib/api/types";
import { isClientError } from "./errors";

/** 다른 참여자가 들어오거나 고치는 것을 보이게 하는 주기. 탭이 보이지 않으면 멈춘다(TanStack 기본). */
const POLL_MS = 15_000;

/** 4xx는 다시 불러도 같으므로 재시도하지 않는다. 서버가 깨는 중인 오류(5xx·연결 실패)는 두 번까지 다시 시도한다. */
const retry = (count: number, error: unknown) => !isClientError(error) && count < 2;

const roomKey = (roomId: string, participantId: string | null) => ["room", roomId, participantId] as const;

export function roomQueryOptions(roomId: string, participantToken: string | null, participantId: string | null) {
  return queryOptions({
    queryKey: roomKey(roomId, participantId),
    queryFn: ({ signal }) => getRoom(roomId, participantToken, { signal }),
    retry,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 4000),
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
    // 내 토큰으로 바뀌는 동안(참여 직후) 이전 방 화면을 그대로 둔다.
    placeholderData: keepPreviousData,
  });
}

export type ResultQuery = { mode: Mode; favor: string | null };

export function roomResultQueryOptions(
  roomId: string,
  query: ResultQuery,
  participantToken: string | null,
  participantId: string | null,
) {
  return queryOptions({
    queryKey: ["room-result", roomId, participantId, query.mode, query.favor] as const,
    queryFn: ({ signal }) => getRoomResult(roomId, query, participantToken, { signal }),
    retry,
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
    placeholderData: keepPreviousData,
  });
}
