/**
 * 방 API 호출. 미리보기(`getRoomPreview`)만 서버(메타데이터·그림 경로)에서도 부르고, 나머지는 브라우저 전용이다. 토큰은 `Authorization: Bearer` 헤더로만 보내고 URL·본문·로그에 넣지 않는다.
 * 계약: contracts/openapi.yaml(rooms·participants·result·outcome). 오류는 [ApiRequestError]로 던진다(code로 분기).
 */
import { client, failure, LAST_TRAIN_KINDS, trustedServerHeaders } from "./client";
import type {
  DecisionRequest,
  DrawRoomCreateRequest,
  FilledRoomCreateRequest,
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

/**
 * 방장이 모두의 칸을 채운 사다리 방(#227). 이 경로를 모르는 옛 서버는 아무것도 저장하지 않고 404(또는 405)로 거절한다
 * (`isDrawRoomUnsupported`).
 */
export async function createDrawRoom(
  body: DrawRoomCreateRequest,
  idempotencyKey: string,
  { signal }: Options = {},
): Promise<RoomCreated> {
  const result = await client().POST("/draw-rooms", {
    body,
    params: { header: { "Idempotency-Key": idempotencyKey } },
    cache: "no-store",
    ...(signal ? { signal } : {}),
  });
  if (result.data !== undefined) return result.data;
  throw failure(result.response.status, result.error);
}

/** 일반 추천부터 보는 채운 방. 이전 서버에 다른 생성 경로로 재시도하지 않는다. */
export async function createFilledRoom(body: FilledRoomCreateRequest, idempotencyKey: string): Promise<RoomCreated> {
  const result = await client().POST("/filled-rooms", {
    body,
    params: { header: { "Idempotency-Key": idempotencyKey } },
    cache: "no-store",
  });
  if (result.data !== undefined) return result.data;
  throw failure(result.response.status, result.error);
}

/**
 * 방 상태. 참여자 토큰이 있으면 본인 항목(출발역이 숨김이어도)과 `isSelf`가 채워진다. 서버(방 미리보기 그림 경로)에서 부르면 신뢰 헤더를
 * 붙인다: 없으면 서버가 모든 호출을 Worker 한 곳에서 온 것으로 세어 메신저가 여러 방을 한꺼번에 읽을 때 429가 난다.
 */
export async function getRoom(
  roomId: string,
  participantToken: string | null,
  { signal }: Options = {},
): Promise<Room> {
  const headers = optionalBearer(participantToken);
  const result = await client(await trustedServerHeaders()).GET("/rooms/{roomId}", {
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

export async function startFavorDraw(roomId: string, hostToken: string, seenVersion: number): Promise<Room> {
  const result = await client().POST("/rooms/{roomId}/favor-draw/start", {
    params: { path: { roomId } },
    headers: bearer(hostToken),
    body: { seenVersion },
    cache: "no-store",
  });
  if (result.data !== undefined) return result.data;
  throw failure(result.response.status, result.error);
}

/**
 * '누구 쪽으로' 뽑기(#172, 방장). `generation`은 화면이 본 `favorDraw.generation`, `round`는 화면이 본 `favorDraw.round` + 1이다.
 * 같은 세대에서 방이 이미 그 회차 이상이면 서버가 바꾸지 않고 지금 방을 돌려준다(재시도 안전). 세대가 바뀌었으면 409 `ROOM_CHANGED`. 응답은 토큰 없는 요청과 같은 시점이라(`isSelf` 없음) 방 캐시에 넣지 말고 다시 불러온다.
 */
export async function drawFavorTarget(
  roomId: string,
  hostToken: string,
  generation: number,
  round: number,
  idempotencyKey: string,
): Promise<Room> {
  const result = await client().POST("/rooms/{roomId}/favor-draw", {
    params: { path: { roomId }, header: { "Idempotency-Key": idempotencyKey } },
    headers: bearer(hostToken),
    body: { generation, round },
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
    params: {
      path: { roomId },
      query: { mode: query.mode, ...(query.favor ? { favor: query.favor } : {}), lastTrainKinds: LAST_TRAIN_KINDS },
    },
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
    params: { path: { roomId }, query: { lastTrainKinds: LAST_TRAIN_KINDS } },
    cache: "no-store",
    ...(signal ? { signal } : {}),
  });
  if (result.data !== undefined) return result.data;
  throw failure(result.response.status, result.error);
}
