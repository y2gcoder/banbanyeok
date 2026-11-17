/** 방 화면의 서버 상태(TanStack Query). 토큰은 키에 넣지 않는다(참여자 ID로 구분한다). */
import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { getRoom, getRoomPreview, getRoomResult } from "@/lib/api/rooms";
import type { Mode } from "@/lib/api/types";
import { isClientError, isRoomGone } from "./errors";

/** 다른 참여자가 들어오거나 고치는 것을 보이게 하는 주기. 탭이 보이지 않으면 멈춘다(TanStack 기본). */
const POLL_MS = 15_000;

/** 4xx는 다시 불러도 같으므로 재시도하지 않는다. 서버가 깨는 중인 오류(5xx·연결 실패)는 두 번까지 다시 시도한다. */
const retry = (count: number, error: unknown) => !isClientError(error) && count < 2;

/** 방이 없다는 답(삭제·만료)은 되살릴 수 없으므로 폴링과 포커스 재요청을 멈춘다. */
const pollWhileAlive = (query: { state: { error: unknown } }) => (isRoomGone(query.state.error) ? false : POLL_MS);
const refetchOnFocusWhileAlive = (query: { state: { error: unknown } }) => !isRoomGone(query.state.error);

export const roomKey = (roomId: string, participantId: string | null) => ["room", roomId, participantId] as const;

export function roomQueryOptions(roomId: string, participantToken: string | null, participantId: string | null) {
  return queryOptions({
    queryKey: roomKey(roomId, participantId),
    queryFn: ({ signal }) => getRoom(roomId, participantToken, { signal }),
    retry,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 4000),
    refetchInterval: pollWhileAlive,
    refetchOnWindowFocus: refetchOnFocusWhileAlive,
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
    refetchInterval: pollWhileAlive,
    refetchOnWindowFocus: refetchOnFocusWhileAlive,
    staleTime: 5_000,
    placeholderData: keepPreviousData,
  });
}

/**
 * 공유 칸의 링크와 문구. 키에 방의 공유 번호가 들어 있어 방 폴링(15초)이 시계다: 번호가 바뀌면 새로 받고, 같은 번호는 다시 받지 않는다.
 * 새 번호를 받는 동안은 이전 미리보기(번호와 문구가 한 쌍)를 그대로 쓴다. 번호를 보내지 않는 옛 서버면 부르지 않는다.
 */
export function roomPreviewQueryOptions(roomId: string, shareVersion: number | undefined) {
  return queryOptions({
    queryKey: ["room-preview", roomId, shareVersion ?? null] as const,
    queryFn: ({ signal }) => getRoomPreview(roomId, { signal }),
    enabled: shareVersion !== undefined,
    retry,
    staleTime: Number.POSITIVE_INFINITY,
    placeholderData: keepPreviousData,
  });
}
