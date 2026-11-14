"use client";

import { useRef } from "react";
import { newIdempotencyKey } from "@/lib/api/rooms";

/**
 * 방 만들기·참여의 `Idempotency-Key`. **같은 내용을 다시 보내는 재시도**(두 번 누름, 네트워크 재시도)에는 같은 키를 써서
 * 서버가 하나만 만들게 하고, 내용이 바뀌면 새 키를 쓴다(고친 입력이 이전 응답으로 재생되지 않게).
 */
export function useIdempotencyKey(): (body: unknown) => string {
  const last = useRef<{ fingerprint: string; key: string } | null>(null);
  return (body) => {
    const fingerprint = JSON.stringify(body);
    if (last.current?.fingerprint !== fingerprint) last.current = { fingerprint, key: newIdempotencyKey() };
    return last.current.key;
  };
}
