import { newIdempotencyKey } from "@/lib/api/rooms";

/**
 * 방 만들기·참여의 `Idempotency-Key` 보관.
 *
 * - **같은 내용을 다시 보내는 재시도**(두 번 누름, 네트워크 재시도)에는 같은 키를 써서 서버가 하나만 만들게 한다.
 * - 내용이 바뀌면 새 키를 쓴다(고친 입력이 이전 응답으로 재생되지 않게).
 * - **성공하면 [renew]로 키를 버려야 한다.** 서버는 같은 키의 성공 응답(토큰 포함)을 10분간 그대로 재생한다. 나가기·내보내짐 뒤
 *   같은 입력으로 다시 참여할 때 키가 그대로면 이미 지워진 항목의 죽은 토큰을 받게 된다.
 */
export type KeyTracker = {
  keyFor: (body: unknown) => string;
  renew: () => void;
};

export function createKeyTracker(newKey: () => string = newIdempotencyKey): KeyTracker {
  let last: { fingerprint: string; key: string } | null = null;
  return {
    keyFor(body) {
      const fingerprint = JSON.stringify(body);
      if (last?.fingerprint !== fingerprint) last = { fingerprint, key: newKey() };
      return last.key;
    },
    renew() {
      last = null;
    },
  };
}
