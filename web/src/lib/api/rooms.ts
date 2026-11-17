/**
 * 방 API 호출. 미리보기(`getRoomPreview`)만 서버(메타데이터·그림 경로)에서도 부르고, 나머지는 브라우저 전용이다. 토큰은 `Authorization: Bearer` 헤더로만 보내고 URL·본문·로그에 넣지 않는다.
 * 계약: contracts/openapi.yaml(rooms·participants·result·outcome). 오류는 [ApiRequestError]로 던진다(code로 분기).
 */
import { client, failure, trustedServerHeaders } from "./client";
import type {
  DecisionRequest,
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
  RoomPreview,
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

/**
 * 정하기·바꾸기·풀기(`stationCode: null`). `seenVersion`은 화면이 그린 공유 번호다: 결과 카드에서 정하면 그 결과의 `shareVersion`,
 * 정한 역 풀기는 방의 `shareVersion`. 그 뒤 방이 바뀌었으면 409 `ROOM_CHANGED`.
 */
export async function setDecision(roomId: string, participantToken: string, body: DecisionRequest): Promise<Room> {
  const result = await client().PUT("/rooms/{roomId}/decision", {
    params: { path: { roomId } },
    headers: bearer(participantToken),
    body,
    cache: "no-store",
  });
  if (result.data !== undefined) return result.data;
  throw failure(result.response.status, result.error);
}

/**
 * 링크 미리보기 내용(누가 묻든 같은 값, 출발역 필드 없음). 토큰을 보내지 않는다. 서버(Workers)에서 부르면 신뢰 헤더를 붙인다.
 */
export async function getRoomPreview(roomId: string, { signal }: Options = {}): Promise<RoomPreview> {
  const result = await client(await trustedServerHeaders()).GET("/rooms/{roomId}/preview", {
    params: { path: { roomId } },
    cache: "no-store",
    ...(signal ? { signal } : {}),
  });
  if (result.data !== undefined) return result.data;
  throw failure(result.response.status, result.error);
}
