/**
 * 채운 사다리 방 만들기 시도(#227, ADR-0011). 요청을 보내기 **전에** 이 기기에 재시도 키와 복구 키를 저장해 둔다. 서버가 방을 만든 뒤
 * 응답을 잃었어도(연결 끊김, 탭 닫힘, 다른 서버 인스턴스) 같은 입력으로 다시 누르면 같은 키를 보내 같은 방과 새 방장 토큰을 받는다.
 *
 * - 키: `bby.draw-room.attempt` 하나. 방 기록(`bby.room.`)과 접두사가 달라 그 정리 규칙에 걸리지 않는다.
 * - 입력은 원문 대신 SHA-256 해시만 둔다(같은 입력인지만 본다). 서버의 복구 기간(24시간)보다 조금 짧게 쓴다.
 * - 방장 기록을 저장했거나 방을 지웠으면 지운다. 저장소가 막혀 이 시도를 저장하지 못하면 방을 만들지 않는다.
 */
import type { DrawRoomInput } from "./draw-room";

export type DrawRoomAttempt = { idempotencyKey: string; recoveryKey: string };

export const DRAW_ROOM_ATTEMPT_KEY = "bby.draw-room.attempt";
const ATTEMPT_LIFETIME_MS = 23 * 3_600_000;

type Stored = DrawRoomAttempt & { v: 1; input: string; savedAt: number };

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

async function fingerprint(input: DrawRoomInput): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(input)));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

function read(store: Storage): Stored | null {
  try {
    const parsed = JSON.parse(store.getItem(DRAW_ROOM_ATTEMPT_KEY) ?? "null") as Partial<Stored> | null;
    if (parsed?.v !== 1 || typeof parsed.input !== "string" || typeof parsed.savedAt !== "number") return null;
    if (typeof parsed.idempotencyKey !== "string" || typeof parsed.recoveryKey !== "string") return null;
    return parsed as Stored;
  } catch {
    return null;
  }
}

/**
 * 이 입력의 시도 키. 같은 입력의 저장된 시도가 아직 유효하면 그 키를, 아니면 새 키를 저장해 돌려준다. 저장하지 못하면(저장소가 막힘)
 * null이고, 이때는 방을 만들지 않는다(응답을 잃으면 되찾을 수 없는 방이 생긴다).
 */
export async function beginDrawRoomAttempt(
  input: DrawRoomInput,
  now: number = Date.now(),
): Promise<DrawRoomAttempt | null> {
  const store = storage();
  if (!store) return null;
  const hash = await fingerprint(input);
  const saved = read(store);
  if (saved && saved.input === hash && now - saved.savedAt < ATTEMPT_LIFETIME_MS) {
    return { idempotencyKey: saved.idempotencyKey, recoveryKey: saved.recoveryKey };
  }
  const attempt = { idempotencyKey: crypto.randomUUID(), recoveryKey: crypto.randomUUID() };
  const value = JSON.stringify({ v: 1, input: hash, savedAt: now, ...attempt } satisfies Stored);
  try {
    store.setItem(DRAW_ROOM_ATTEMPT_KEY, value);
    return store.getItem(DRAW_ROOM_ATTEMPT_KEY) === value ? attempt : null;
  } catch {
    return null;
  }
}

/** 시도가 끝났다(방장 기록을 저장했거나 만든 방을 지웠다). 다음 시도는 새 키로 만든다. */
export function endDrawRoomAttempt(): void {
  try {
    storage()?.removeItem(DRAW_ROOM_ATTEMPT_KEY);
  } catch {
    // 지우지 못해도 수명(23시간)이 지나면 새 키를 쓴다.
  }
}
