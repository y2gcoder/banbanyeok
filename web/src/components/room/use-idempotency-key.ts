"use client";

import { useRef } from "react";
import { createKeyTracker, type KeyTracker } from "@/lib/room/idempotency";

/** 화면 수명 동안 같은 [KeyTracker]를 쓴다. 규칙은 `lib/room/idempotency.ts`. */
export function useIdempotencyKey(): KeyTracker {
  const tracker = useRef<KeyTracker | null>(null);
  tracker.current ??= createKeyTracker();
  return tracker.current;
}
