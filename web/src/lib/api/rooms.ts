/**
 * 방 API 호출(브라우저 전용). 토큰은 `Authorization: Bearer` 헤더로만 보내고 URL·본문·로그에 넣지 않는다.
 * 계약: contracts/openapi.yaml(rooms·participants·result·outcome). 오류는 [ApiRequestError]로 던진다(code로 분기).
 */
import { client, failure } from "./client";
import type {
  JoinedRoom,
  Mode,
  OutcomeAnswer,
  ParticipantInput,
  RecommendResult,
  Room,
  RoomCreated,
  RoomCreateRequest,
  RoomParticipant,
  RoomPatch,
} from "./types";

type Options = { signal?: AbortSignal | undefined };

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const optionalBearer = (token: string | null | undefined) => (token ? bearer(token) : undefined);

/** 같은 시도를 다시 보낼 때 같은 값을 쓰면 서버가 10분간 같은 응답을 돌려준다(두 번 눌러도 방·참여가 하나). */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export async function createRoom(
  body: RoomCreateRequest,
  idempotencyKey: string,
  { signal }: Options = {},
): Promise<RoomCreated> {
  const result = await client().POST("/rooms", {
    body,
    params: { header: { "Idempotency-Key": idempotencyKey } },
    cache: "no-store",
    ...(signal ? { signal } : {}),
  });
  if (result.data !== undefined) return result.data;
  throw failure(result.response.status, result.error);
}

/** 방 상태. 참여자 토큰이 있으면 본인 항목(출발역이 숨김이어도)과 `isSelf`가 채워진다. */
export async function getRoom(
  roomId: string,
  participantToken: string | null,
  { signal }: Options = {},
): Promise<Room> {
  const headers = optionalBearer(participantToken);
  const result = await client().GET("/rooms/{roomId}", {
    params: { path: { roomId } },
    cache: "no-store",
    ...(headers ? { headers } : {}),
    ...(signal ? { signal } : {}),
  });
  if (result.data !== undefined) return result.data;
  throw failure(result.response.status, result.error);
}

export async function joinRoom(
  roomId: string,
  input: ParticipantInput,
  idempotencyKey: string,
  { signal }: Options = {},
): Promise<JoinedRoom> {
  const result = await client().POST("/rooms/{roomId}/participants", {
    params: { path: { roomId }, header: { "Idempotency-Key": idempotencyKey } },
    body: input,
    cache: "no-store",
    ...(signal ? { signal } : {}),
  });
  if (result.data !== undefined) return result.data;
  throw failure(result.response.status, result.error);
}

export async function updateParticipant(
  roomId: string,
  participantId: string,
  participantToken: string,
  input: ParticipantInput,
): Promise<RoomParticipant> {
  const result = await client().PUT("/rooms/{roomId}/participants/{participantId}", {
    params: { path: { roomId, participantId } },
    headers: bearer(participantToken),
    body: input,
    cache: "no-store",
  });
  if (result.data !== undefined) return result.data;
  throw failure(result.response.status, result.error);
}

/** 자기 항목 삭제(참여자 토큰) 또는 방장의 내보내기(방장 토큰). */
export async function removeParticipant(roomId: string, participantId: string, token: string): Promise<void> {
  const result = await client().DELETE("/rooms/{roomId}/participants/{participantId}", {
    params: { path: { roomId, participantId } },
    headers: bearer(token),
    cache: "no-store",
  });
  if (!result.response.ok) throw failure(result.response.status, result.error);
}

export async function updateRoom(roomId: string, hostToken: string, patch: RoomPatch): Promise<Room> {
  const result = await client().PATCH("/rooms/{roomId}", {
    params: { path: { roomId } },
    headers: bearer(hostToken),
    body: patch,
    cache: "no-store",
  });
  if (result.data !== undefined) return result.data;
  throw failure(result.response.status, result.error);
}

export async function deleteRoom(roomId: string, hostToken: string): Promise<void> {
  const result = await client().DELETE("/rooms/{roomId}", {
    params: { path: { roomId } },
    headers: bearer(hostToken),
    cache: "no-store",
  });
  if (!result.response.ok) throw failure(result.response.status, result.error);
}

/** 서버가 계산한 방 결과. 숨긴 참가자의 출발역은 가려지고 시간·환승은 보인다. */
export async function getRoomResult(
  roomId: string,
  query: { mode: Mode; favor: string | null },
  participantToken: string | null,
  { signal }: Options = {},
): Promise<RecommendResult> {
  const headers = optionalBearer(participantToken);
  const result = await client().GET("/rooms/{roomId}/result", {
    params: { path: { roomId }, query: { mode: query.mode, ...(query.favor ? { favor: query.favor } : {}) } },
    cache: "no-store",
    ...(headers ? { headers } : {}),
    ...(signal ? { signal } : {}),
  });
  if (result.data !== undefined) return result.data;
  throw failure(result.response.status, result.error);
}

export async function answerOutcome(roomId: string, participantToken: string, answer: OutcomeAnswer): Promise<void> {
  const result = await client().POST("/rooms/{roomId}/outcome", {
    params: { path: { roomId } },
    headers: bearer(participantToken),
    body: answer,
    cache: "no-store",
  });
  if (!result.response.ok) throw failure(result.response.status, result.error);
}
