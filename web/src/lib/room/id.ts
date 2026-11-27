/**
 * 방 ID와 방 링크. 방 링크는 `/r/{roomId}`이고 **토큰·참여자 정보를 어떤 주소에도 넣지 않는다**(contracts/data-format.md §7).
 * ID는 10자 Crockford base32이고 서버가 대소문자를 구별하지 않는다(소문자로 저장).
 */
const ROOM_ID_PATTERN = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{10}$/;

export function isRoomId(text: string): boolean {
  return ROOM_ID_PATTERN.test(text);
}

/** 저장 키·비교용 정규형(소문자). 같은 방을 대소문자만 다르게 열어도 같은 토큰을 쓴다. */
export function normalizeRoomId(roomId: string): string {
  return roomId.toLowerCase();
}

export function roomPath(roomId: string): `/r/${string}` {
  return `/r/${normalizeRoomId(roomId)}`;
}

export const NEW_ROOM_PATH = "/r/new";
