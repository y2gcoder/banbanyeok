/**
 * 방 토큰의 기기 저장(tech-stack 5.5의 원래 계획: 방별 localStorage 키). 쿠키·deviceToken은 쓰지 않는다.
 *
 * - 키: `bby.room.<방 ID 소문자>` 하나에 방장 토큰·참여자 토큰·참여자 ID·만료 시각을 JSON으로 둔다.
 * - 토큰은 URL·로그·통계·미리보기에 넣지 않는다(이 모듈 밖에서는 `Authorization` 헤더에만 쓴다).
 * - **기기가 먼저 지우지 않는다**: 서버는 누가 고칠 때마다 만료를 7일씩 미루므로(최대 생성 후 30일, ExpiryPolicy) 이 기기가 아는
 *   만료 시각은 금방 낡는다. 그래서 만료 시각을 저장하지 않고, 서버 규칙상 어떤 경우에도 방이 사라진 시점(`keepUntil` =
 *   처음 저장한 시각 + 30일. 방은 그보다 먼저 만들어졌으므로 그때는 확실히 만료)이 지난 기록만 지운다(`pruneExpiredRooms`).
 *   그 전에 방이 없어졌는지는 방을 열었을 때 서버가 404로 알려 주고, 그때 지운다.
 * - localStorage는 막혀 있을 수 있다(사파리 개인 모드 등). 실패하면 조용히 무시한다(저장을 못 하면 이 기기에서 고치지 못할 뿐이다).
 */
import { z } from "../zod";
import { normalizeRoomId } from "./id";

export const ROOM_KEY_PREFIX = "bby.room.";

const recordSchema = z.object({
  v: z.literal(1),
  hostToken: z.string().min(1).optional(),
  participantToken: z.string().min(1).optional(),
  participantId: z.string().min(1).optional(),
  /** 이 시각이 지나면 방이 확실히 없다(처음 저장한 시각 + 30일). 지나서 연 사이트에서만 기록을 지운다. */
  keepUntil: z.iso.datetime({ offset: true }),
  /** 방장이 방을 만들 때 정한 예상 인원. 정원이 차서 잠긴 것과 방장이 잠근 것을 구별해 안내하는 데만 쓴다. */
  expectedCount: z.number().int().min(2).max(4).optional(),
  /** 이 기기에서 이 방의 결과를 처음 본 시각(ISO). 통계의 "결과를 본 뒤 경과 일수"에만 쓴다. */
  resultSeenAt: z.iso.datetime({ offset: true }).optional(),
  /** "실제로 어디서 만났나"에 이미 답했는지. 같은 질문을 다시 보여 주지 않기 위해서다. */
  outcomeAnswered: z.boolean().optional(),
  /**
   * 이 기기에서 그림을 이미 본 '누구 쪽으로' 뽑기(#172, `drawKey`: 회차와 뽑은 시각). 같은 결과의 그림을 다시 틀지 않기 위해서만 쓴다.
   */
  drawSeen: z.string().min(1).max(64).optional(),
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

const MAX_ROOM_LIFETIME_MS = 30 * 86_400_000;

/** 지금 처음 저장하는 기록의 `keepUntil`(방 최대 수명 30일 뒤). */
export const keepUntilFrom = (now: number = Date.now()): string => new Date(now + MAX_ROOM_LIFETIME_MS).toISOString();

const isExpired = (record: RoomRecord, now: number) => Date.parse(record.keepUntil) <= now;

/** 이 방의 저장된 기록. 없거나 깨졌거나 최대 수명이 지났으면 null(그런 기록은 그 자리에서 지운다). */
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

/**
 * 기록을 저장하거나(`null`이면 지운다) 한다. 저장소가 막혀 있어도 던지지 않는다: 화면은 이 함수와 별개로 기록을 **컴포넌트 상태에도**
 * 들고 있어야 한다(저장이 실패해도 방금 받은 토큰으로 이번 방문 동안은 계속 쓸 수 있게).
 */
export function writeRoomRecord(roomId: string, record: RoomRecord | null): void {
  if (!record) {
    removeRoomRecord(roomId);
    return;
  }
  const { v: _version, ...rest } = record;
  saveRoomRecord(roomId, rest);
}

/**
 * 내 참여 항목이 없어졌다(내가 지움·내보내짐): 참여자 토큰·ID를 뺀 기록. 방장 토큰도 없으면 남길 것이 없으므로 null.
 */
export function withoutParticipant(record: RoomRecord): RoomRecord | null {
  const { participantToken: _token, participantId: _id, ...rest } = record;
  return rest.hostToken ? rest : null;
}

export function removeRoomRecord(roomId: string): void {
  try {
    storage()?.removeItem(roomKey(roomId));
  } catch {
    // 지우지 못해도 다음에 열 때 만료로 정리된다.
  }
}

/** 최대 수명이 지났거나 깨진 방 기록을 모두 지운다. 지운 개수를 돌려준다. */
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
