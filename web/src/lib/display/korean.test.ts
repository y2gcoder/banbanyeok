import { describe, expect, it } from "vitest";
import { stationLabel, withJosa } from "./korean";

// shared/app-logic DisplayRulesTest와 같은 사례.
describe("조사", () => {
  it.each([
    ["지훈", "은/는", "지훈은"],
    ["민지", "은/는", "민지는"],
    ["지훈", "이/가", "지훈이"],
    ["민지", "이/가", "민지가"],
    ["합정", "과/와", "합정과"],
    ["을지로3가", "과/와", "을지로3가와"],
    ["A", "은/는", "A는"],
    ["M", "은/는", "M은"],
    ["l", "이/가", "l이"],
    ["친구1", "이/가", "친구1이"],
    ["친구2", "이/가", "친구2가"],
    ["팀7", "은/는", "팀7은"],
    ["강남에서 오는 분", "이/가", "강남에서 오는 분이"],
    ["참가자 2", "이/가", "참가자 2가"],
    ["지훈🎂", "은/는", "지훈🎂은"],
    ["민지(회사)", "은/는", "민지(회사)는"],
    ["🎂", "은/는", "🎂는"],
  ] as const)("%s + %s → %s", (word, josa, expected) => {
    expect(withJosa(word, josa)).toBe(expected);
  });

  it("역 이름에 역을 한 번만 붙인다", () => {
    expect(stationLabel("신촌")).toBe("신촌역");
    expect(stationLabel("서울역")).toBe("서울역");
  });
});
