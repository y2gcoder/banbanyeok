import { describe, expect, it } from "vitest";
import { createKeyTracker } from "./idempotency";

const counter = () => {
  let n = 0;
  return () => `key-${++n}`;
};

describe("멱등 키", () => {
  it("같은 내용의 재시도에는 같은 키, 내용이 바뀌면 새 키", () => {
    const tracker = createKeyTracker(counter());
    const first = tracker.keyFor({ originCode: "k3a", hidden: true });
    expect(tracker.keyFor({ originCode: "k3a", hidden: true })).toBe(first);
    expect(tracker.keyFor({ originCode: "ryf", hidden: true })).not.toBe(first);
  });

  it("성공 뒤 renew하면 같은 내용으로 다시 참여해도 새 키(서버가 지난 성공 응답을 재생하지 않게)", () => {
    const tracker = createKeyTracker(counter());
    const body = { originCode: "ryf", hidden: true };
    const joined = tracker.keyFor(body); // 참여
    tracker.renew(); // 참여 성공 직후
    const afterLeave = tracker.keyFor(body); // 나갔다가 같은 입력으로 다시 참여
    expect(afterLeave).not.toBe(joined);
    tracker.renew(); // 나가기 성공 직후
    expect(tracker.keyFor(body)).not.toBe(afterLeave);
  });
});
