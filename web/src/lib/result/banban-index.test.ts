import { describe, expect, it } from "vitest";
import { banbanIndex, mayIncludeHidden } from "./banban-index";

const fair = { mode: "fair" as const, others: [], hidden: false };

describe("반반지수 시안(#202)", () => {
  it("숨긴 참가자가 있으면 본인(정확한 시간)과 남(5분 단위)의 등급이 갈리지 않게 끈다", () => {
    expect(banbanIndex("toptwo", { ...fair, top: [21, 22] })?.label).toBe("딱 반반");
    expect(banbanIndex("toptwo", { ...fair, top: [21, 22], hidden: true })).toBeNull();
  });

  it("방 그림은 5분 배수 시간이 있으면 숨긴 사람이 있을 수 있다고 보고 끈다", () => {
    expect(mayIncludeHidden([25, 22])).toBe(true);
    expect(mayIncludeHidden([21, 22, null])).toBe(false);
  });

  it("비교할 후보를 모르면(방 그림) 낮은 등급을 그리지 않는다", () => {
    expect(banbanIndex("toptwo", { ...fair, top: [30, 50], others: null })).toBeNull();
    expect(banbanIndex("toptwo", { ...fair, top: [30, 50], others: [] })?.label).toBe("이 조합에선 가장 반반");
  });

  it("공평 기준이 아니면 등급이 없다", () => {
    expect(banbanIndex("toptwo", { ...fair, mode: "fast", top: [21, 22] })).toBeNull();
  });
});
