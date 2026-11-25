import { describe, expect, it } from "vitest";
import { banbanIndex, mayIncludeHidden } from "./banban-index";

const fair = { mode: "fair" as const, others: [], hidden: false };

describe("반반지수 시안(#202)", () => {
  it("숨긴 참가자가 있으면 본인(정확한 시간)과 남(5분 단위)의 말이 갈리지 않게 끈다", () => {
    expect(banbanIndex("toptwo", { ...fair, top: [21, 22] })).toMatchObject({ label: "딱 반반" });
    expect(banbanIndex("toptwo", { ...fair, top: [21, 22], hidden: true })).toBeNull();
    expect(banbanIndex("fact", { ...fair, top: [21, 22] })).toMatchObject({ sentence: "두 사람 1분 차이로 도착해요" });
    expect(banbanIndex("fact", { ...fair, top: [21, 22], hidden: true })).toBeNull();
  });

  it("방 그림은 5분 배수 시간이 있으면 숨긴 사람이 있을 수 있다고 보고 끈다", () => {
    expect(mayIncludeHidden([25, 22])).toBe(true);
    expect(mayIncludeHidden([21, 22, null])).toBe(false);
  });

  it("비교할 후보를 모르면(방 그림) 낮은 등급을 그리지 않는다", () => {
    expect(banbanIndex("toptwo", { ...fair, top: [30, 50], others: null })).toBeNull();
    expect(banbanIndex("toptwo", { ...fair, top: [30, 50], others: [] })).toMatchObject({
      label: "이 조합에선 가장 반반",
    });
  });

  it("공평 기준이 아니면 등급도 사실 문장도 없다", () => {
    expect(banbanIndex("toptwo", { ...fair, mode: "fast", top: [21, 22] })).toBeNull();
    expect(banbanIndex("fact", { ...fair, mode: "fast", top: [21, 22] })).toBeNull();
  });
});

describe("사실 문장 안(bbi=fact|factcap)", () => {
  const sentence = (plan: "fact" | "factcap", top: number[]) => {
    const index = banbanIndex(plan, { ...fair, top });
    return index?.kind === "fact" ? index.sentence : null;
  };

  it("두 사람은 도착 차이 2분까지 실제 차이로 말하고, 그 밖에는 아무 말도 붙이지 않는다", () => {
    expect(sentence("fact", [21, 22])).toBe("두 사람 1분 차이로 도착해요");
    expect(sentence("fact", [20, 22])).toBe("두 사람 2분 차이로 도착해요");
    expect(sentence("factcap", [20, 22])).toBe("두 사람 2분 차이로 도착해요");
    expect(sentence("fact", [22, 22])).toBe("두 사람 같은 시간에 도착해요");
    expect(sentence("fact", [21, 24])).toBeNull();
  });

  it("세 사람 이상은 최장 − 최단 6분까지 말하고, fact는 실제 차이·factcap은 문턱을 쓴다", () => {
    expect(sentence("fact", [30, 34, 32])).toBe("모두 4분 차이 안에 도착해요");
    expect(sentence("factcap", [30, 34, 32])).toBe("모두 6분 차이 안에 도착해요");
    expect(sentence("fact", [30, 36, 33, 31])).toBe("모두 6분 차이 안에 도착해요");
    expect(sentence("fact", [30, 37, 32])).toBeNull();
  });

  it("4명 27·28·16·7분처럼 가장 먼 두 사람만 비슷하면 아무 말도 붙이지 않는다", () => {
    expect(banbanIndex("toptwo", { ...fair, top: [27, 28, 16, 7] })).toMatchObject({ label: "딱 반반" });
    expect(sentence("fact", [27, 28, 16, 7])).toBeNull();
    expect(sentence("factcap", [27, 28, 16, 7])).toBeNull();
  });
});
