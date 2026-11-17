import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api/rooms";
import { PREVIEW_TIMEOUT_MS, roomPreviewQueryOptions } from "./queries";

vi.mock("@/lib/api/rooms");

describe("공유 칸 미리보기 요청", () => {
  let sent: AbortSignal | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    sent = undefined;
    vi.mocked(api.getRoomPreview).mockImplementation(
      (_id, { signal } = {}) =>
        new Promise((_resolve, reject) => {
          sent = signal;
          signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
  });

  afterEach(() => vi.useRealTimers());

  function run(signal: AbortSignal) {
    const { queryFn } = roomPreviewQueryOptions("qt7yvmsht3", 4);
    if (typeof queryFn !== "function") throw new Error("no queryFn");
    return queryFn({ signal } as unknown as Parameters<typeof queryFn>[0]);
  }

  it("서버가 답하지 않으면 제한 시간에 요청을 끊어 다시 시도할 수 있게 한다", async () => {
    const pending = run(new AbortController().signal);
    const outcome = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(PREVIEW_TIMEOUT_MS - 1);
    expect(sent?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent?.aborted).toBe(true);
    await outcome;
  });

  it("쿼리가 취소되면(화면을 떠남) 제한 시간 전이라도 요청을 끊는다", async () => {
    const page = new AbortController();
    const outcome = expect(run(page.signal)).rejects.toThrow();
    page.abort();
    expect(sent?.aborted).toBe(true);
    await outcome;
  });
});
