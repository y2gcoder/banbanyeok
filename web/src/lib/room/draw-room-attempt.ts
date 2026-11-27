/**
 * 채운 사다리 방 만들기 시도(#227, ADR-0011). 요청을 보내기 **전에** 이 기기에 재시도 키와 복구 키를 저장해 둔다. 서버가 방을 만든 뒤
 * 응답을 잃었어도(연결 끊김, 탭 닫힘, 다른 서버 인스턴스) 같은 입력으로 다시 누르면 같은 키를 보내 같은 방과 같은 방장 토큰을 받는다.
 *
 * - 키: `bby.draw-room.attempt` 하나에 입력마다 시도 하나. 다른 입력으로 방을 만들어도 앞서 잃은 시도는 남는다. 방 기록(`bby.room.`)과
 *   접두사가 달라 그 정리 규칙에 걸리지 않는다.
 * - 입력은 원문 대신 SHA-256 해시만 둔다(같은 입력인지만 본다). 서버의 복구 기간(24시간)보다 조금 짧게 쓰고, 지난 시도는 다음 시도 때 지운다.
 * - 방장 기록을 저장했거나 방을 지웠으면 그 시도만 지운다. 저장소가 막혀 시도를 저장하지 못하면 방을 만들지 않는다.
 * - 읽고 고쳐 쓰는 동안은 같은 출처의 탭끼리 잠근다(Web Locks). 두 탭이 같은 입력으로 동시에 눌러도 같은 키를 쓴다.
 */
import type { DrawRoomInput } from "./draw-room";

export type DrawRoomAttempt = { id: string; idempotencyKey: string; recoveryKey: string };

export const DRAW_ROOM_ATTEMPT_KEY = "bby.draw-room.attempt";
const ATTEMPT_LIFETIME_MS = 23 * 3_600_000;
/** 기기에 남겨 둘 시도 수(새 것부터). 같은 날 다른 입력으로 여러 번 시도해도 앞선 시도를 되찾을 만큼. */
const MAX_ATTEMPTS = 8;

type Saved = { idempotencyKey: string; recoveryKey: string; savedAt: number };
type Stored = { v: 2; attempts: Record<string, Saved> };

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

const isSaved = (value: unknown): value is Saved =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as Saved).idempotencyKey === "string" &&
  typeof (value as Saved).recoveryKey === "string" &&
  typeof (value as Saved).savedAt === "number";

/** 아직 유효한 시도들. 깨졌거나 지난 것은 뺀다. */
function read(store: Storage, now: number): Record<string, Saved> {
  try {
    const parsed = JSON.parse(store.getItem(DRAW_ROOM_ATTEMPT_KEY) ?? "null") as Partial<Stored> | null;
    if (parsed?.v !== 2 || typeof parsed.attempts !== "object" || parsed.attempts === null) return {};
    return Object.fromEntries(
      Object.entries(parsed.attempts).filter(
        ([, saved]) => isSaved(saved) && now - saved.savedAt < ATTEMPT_LIFETIME_MS,
      ),
    );
  } catch {
    return {};
  }
}

function write(store: Storage, attempts: Record<string, Saved>): boolean {
  const newest = Object.entries(attempts)
    .sort(([, a], [, b]) => b.savedAt - a.savedAt)
    .slice(0, MAX_ATTEMPTS);
  if (newest.length === 0) {
    store.removeItem(DRAW_ROOM_ATTEMPT_KEY);
    return true;
  }
  const value = JSON.stringify({ v: 2, attempts: Object.fromEntries(newest) } satisfies Stored);
  store.setItem(DRAW_ROOM_ATTEMPT_KEY, value);
  return store.getItem(DRAW_ROOM_ATTEMPT_KEY) === value;
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
  const id = await fingerprint(input);
  return acrossTabs(() => takeAttempt(store, id, now));
}

/** 같은 출처의 다른 탭이 이 기록을 읽고 고쳐 쓰는 동안 기다린다. Web Locks가 없는 브라우저는 그대로 실행한다. */
async function acrossTabs<T>(work: () => T): Promise<T> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  return locks ? locks.request(DRAW_ROOM_ATTEMPT_KEY, async () => work()) : work();
}

function takeAttempt(store: Storage, id: string, now: number): DrawRoomAttempt | null {
  try {
    const attempts = read(store, now);
    const saved = attempts[id];
    if (saved) return { id, idempotencyKey: saved.idempotencyKey, recoveryKey: saved.recoveryKey };
    const fresh = { idempotencyKey: crypto.randomUUID(), recoveryKey: crypto.randomUUID(), savedAt: now };
    return write(store, { ...attempts, [id]: fresh })
      ? { id, idempotencyKey: fresh.idempotencyKey, recoveryKey: fresh.recoveryKey }
      : null;
  } catch {
    return null;
  }
}

/** 이 시도가 끝났다(방장 기록을 저장했거나 만든 방을 지웠다). 같은 입력의 다음 시도는 새 키로 만든다. 다른 입력의 시도는 그대로다. */
export function endDrawRoomAttempt(id: string, now: number = Date.now()): void {
  const store = storage();
  if (!store) return;
  void acrossTabs(() => {
    try {
      const { [id]: _done, ...rest } = read(store, now);
      write(store, rest);
    } catch {
      // 지우지 못해도 수명(23시간)이 지나면 새 키를 쓴다.
    }
  });
}
