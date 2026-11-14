/**
 * 방 토큰의 기기 저장(tech-stack 5.5의 원래 계획: 방별 localStorage 키). 쿠키·deviceToken은 쓰지 않는다.
 *
 * - 키: `bby.room.<방 ID 소문자>` 하나에 방장 토큰·참여자 토큰·참여자 ID·만료 시각을 JSON으로 둔다.
 * - 토큰은 URL·로그·통계·미리보기에 넣지 않는다(이 모듈 밖에서는 `Authorization` 헤더에만 쓴다).
 * - 만료 시각(서버가 준 `expiresAt`)을 함께 저장하고, 지난 기록은 사이트를 열 때 지운다(`pruneExpiredRooms`).
 *   서버는 활동이 있으면 만료를 미루므로 방을 불러올 때마다 `expiresAt`을 갱신한다.
 * - localStorage는 막혀 있을 수 있다(사파리 개인 모드 등). 실패하면 조용히 무시한다(저장을 못 하면 이 기기에서 고치지 못할 뿐이다).
 */
import { z } from "zod";
import { normalizeRoomId } from "./id";

export const ROOM_KEY_PREFIX = "bby.room.";

const recordSchema = z.object({
  v: z.literal(1),
  hostToken: z.string().min(1).optional(),
  participantToken: z.string().min(1).optional(),
  participantId: z.string().min(1).optional(),
  /** 서버가 알려 준 만료 시각(ISO). 지나면 기록을 지운다. */
  expiresAt: z.iso.datetime({ offset: true }),
  /** 이 기기에서 이 방의 결과를 처음 본 시각(ISO). 통계의 "결과를 본 뒤 경과 일수"에만 쓴다. */
  resultSeenAt: z.iso.datetime({ offset: true }).optional(),
  /** "실제로 어디서 만났나"에 이미 답했는지. 같은 질문을 다시 보여 주지 않기 위해서다. */
  outcomeAnswered: z.boolean().optional(),
});

export type RoomRecord = z.infer<typeof recordSchema>;

export const roomKey = (roomId: string) => `${ROOM_KEY_PREFIX}${normalizeRoomId(roomId)}`;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function parse(raw: string | null): RoomRecord | null {
  if (!raw) return null;
  try {
    const parsed = recordSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const isExpired = (record: RoomRecord, now: number) => Date.parse(record.expiresAt) <= now;

/** 이 방의 저장된 기록. 없거나 깨졌거나 만료됐으면 null(만료·깨진 기록은 그 자리에서 지운다). */
export function loadRoomRecord(roomId: string, now: number = Date.now()): RoomRecord | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(roomKey(roomId));
    const record = parse(raw);
    if (raw && (!record || isExpired(record, now))) store.removeItem(roomKey(roomId));
    return record && !isExpired(record, now) ? record : null;
  } catch {
    return null;
  }
}

/** 이 브라우저가 토큰을 저장할 수 있는지(막혀 있으면 내 항목을 나중에 고칠 수 없다고 미리 알린다). */
export function canStoreRoomTokens(): boolean {
  const store = storage();
  if (!store) return false;
  const probe = `${ROOM_KEY_PREFIX}probe`;
  try {
    store.setItem(probe, "1");
    store.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

export function saveRoomRecord(roomId: string, record: Omit<RoomRecord, "v">): void {
  try {
    storage()?.setItem(roomKey(roomId), JSON.stringify({ v: 1, ...record } satisfies RoomRecord));
  } catch {
    // 저장하지 못해도 방은 동작한다. 이 기기에서 나중에 고치지 못할 뿐이다.
  }
}

/** 기존 기록의 일부를 바꾼다. 값이 `undefined`인 키는 지운다. 기록이 없으면 아무것도 하지 않는다. */
export function patchRoomRecord(roomId: string, patch: Partial<Omit<RoomRecord, "v">>): RoomRecord | null {
  const current = loadRoomRecord(roomId);
  if (!current) return null;
  const next: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  const record = recordSchema.parse(next);
  const { v: _version, ...rest } = record;
  saveRoomRecord(roomId, rest);
  return record;
}

/**
 * 내 참여 항목이 없어졌다(내가 지움·내보내짐): 참여자 토큰·ID를 지운다. 방장 토큰도 없으면 기록 전체를 지운다.
 * 남은 기록(방장이면)을 돌려준다.
 */
export function dropParticipantToken(roomId: string): RoomRecord | null {
  const next = patchRoomRecord(roomId, { participantToken: undefined, participantId: undefined });
  if (!next?.hostToken) {
    removeRoomRecord(roomId);
    return null;
  }
  return next;
}

export function removeRoomRecord(roomId: string): void {
  try {
    storage()?.removeItem(roomKey(roomId));
  } catch {
    // 지우지 못해도 다음에 열 때 만료로 정리된다.
  }
}

/** 만료됐거나 깨진 방 기록을 모두 지운다. 지운 개수를 돌려준다. */
export function pruneExpiredRooms(now: number = Date.now()): number {
  const store = storage();
  if (!store) return 0;
  let removed = 0;
  try {
    const keys: string[] = [];
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key?.startsWith(ROOM_KEY_PREFIX)) keys.push(key);
    }
    for (const key of keys) {
      const record = parse(store.getItem(key));
      if (!record || isExpired(record, now)) {
        store.removeItem(key);
        removed += 1;
      }
    }
  } catch {
    // 정리는 최선 노력이다.
  }
  return removed;
}
