/**
 * 방 이벤트의 방 참조 속성(contracts/events.json `room_hash`, `seconds_since_room_created`).
 *
 * `room_hash`는 서버가 방 응답(`Room.roomHash`, `RoomCreated.roomHash`)에 실어 주는 값을 그대로 쓴다. 서버가 자기 비밀(pepper)로
 * 키를 건 HMAC이라(contracts/openapi.yaml `RoomHash`) 웹에는 솔트가 없고, 통계 도구가 값으로 방 ID를 되돌릴 수 없다.
 * 계약 형식(16자리 소문자 hex)이 아니거나 방 ID를 담고 있으면 보내지 않는다: 서버가 잘못돼도 방 ID 원문이 통계로 새지 않게 한다.
 */

const ROOM_HASH = /^[0-9a-f]{16}$/;

/** 방 응답에서 읽는 필드(옛 서버는 보내지 않는다). */
export type RoomRef = { roomId: string; roomHash?: string | undefined; createdAt?: string | undefined };

/** 보낼 수 있는 `room_hash`. 없거나 형식이 다르거나 방 ID가 들어 있으면 undefined. */
export function roomHashOf(ref: RoomRef): string | undefined {
  const hash = ref.roomHash;
  if (!hash || !ROOM_HASH.test(hash)) return undefined;
  if (ref.roomId && hash.includes(ref.roomId.toLowerCase())) return undefined;
  return hash;
}

/** 이벤트 속성에 펼쳐 넣는 `{ room_hash }`(보낼 값이 없으면 빈 객체). */
export function roomHashProperty(ref: RoomRef): { room_hash?: string } {
  const hash = roomHashOf(ref);
  return hash ? { room_hash: hash } : {};
}

/**
 * 방을 만든 뒤 지난 초(정수, 0 이상). 생성 시각이 없거나 읽을 수 없으면 undefined. 이 기기 시계를 쓰므로 서버 시계보다 느리면 0으로 둔다.
 */
export function secondsSinceRoomCreated(createdAt: string | undefined, now: number = Date.now()): number | undefined {
  if (!createdAt) return undefined;
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return undefined;
  return Math.max(0, Math.floor((now - created) / 1000));
}
