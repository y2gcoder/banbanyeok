import { describe, expect, it } from "vitest";
import { evaluateNotices, type SituationInput } from "./notices";

// shared/app-logic SituationAdvisorTest와 같은 사례. 분 단위 도우미는 분 × 60초.
const c = (stationName: string, ...minutes: number[]) => ({ stationName, seconds: minutes.map((m) => m * 60) });
const evaluate = (candidates: SituationInput["candidates"], extra: Partial<SituationInput> = {}) =>
  evaluateNotices({ mode: "fair", names: ["민지", "지훈"], originCodes: ["03v", "130"], candidates, ...extra });

describe("극단 상황 안내", () => {
  it("후보가 없으면 공통 후보 없음", () => {
    expect(evaluate([])).toEqual([
      { kind: "NO_COMMON_CANDIDATE", text: "모두가 갈 수 있는 역을 찾지 못했어요. 출발역을 바꿔 보세요.", cta: null },
    ]);
  });

  it("모두 같은 출발역이면 같은 동네(그것만)", () => {
    const notices = evaluate([c("신촌", 20, 20), c("합정", 25, 25)], { originCodes: ["03v", "03v"] });
    expect(notices.map((n) => n.text)).toEqual(["이미 같은 동네예요. 신촌역에서 만나세요."]);
  });

  it("숨긴 출발역은 같은 역으로 보지 않는다", () => {
    expect(evaluate([c("신촌", 20, 30)], { originCodes: [null, null] })).toEqual([]);
  });

  it("1위 최장 5분 이하면 같은 동네", () => {
    expect(evaluate([c("서울역", 3, 5)])[0]?.text).toBe("이미 같은 동네예요. 서울역에서 만나세요.");
    expect(evaluate([{ stationName: "신촌", seconds: [100, 300] }])[0]?.kind).toBe("SAME_NEIGHBORHOOD");
    expect(evaluate([{ stationName: "신촌", seconds: [100, 301] }])).toEqual([]);
  });

  it("90분 초과면 가장 오래 걸리는 사람 쪽으로 보기 버튼", () => {
    expect(evaluate([c("신촌", 40, 95)])).toEqual([
      {
        kind: "LONG_TRAVEL",
        text: "누군가는 90분 넘게 걸려요. 한쪽 동네에서 만나는 게 나을 수도 있어요.",
        cta: { favorIndex: 1, label: "지훈 쪽으로 보기" },
      },
    ]);
    expect(evaluate([{ stationName: "신촌", seconds: [2400, 5400] }])).toEqual([]);
    expect(evaluate([c("신촌", 40, 95)], { mode: "favor" })[0]?.cta).toBeNull();
  });

  it("후보끼리 2분 이내면 비슷하다(공평은 최장, 빨리는 합계, 배려는 판단 안 함)", () => {
    expect(evaluate([c("신촌", 38, 30), c("합정", 39, 30), c("을지로3가", 40, 30)])[0]?.text).toBe(
      "세 곳 다 비슷해요. 가고 싶은 동네로 고르세요.",
    );
    expect(evaluate([c("신촌", 38, 30), c("합정", 38, 30)])[0]?.text).toBe(
      "두 곳 다 비슷해요. 가고 싶은 동네로 고르세요.",
    );
    expect(evaluate([c("신촌", 38, 30), c("합정", 41, 30)])).toEqual([]);
    expect(evaluate([c("신촌", 20, 30), c("합정", 10, 42)], { mode: "fast" })[0]?.kind).toBe("SIMILAR_CANDIDATES");
    expect(evaluate([c("신촌", 20, 30), c("합정", 10, 42)], { mode: "favor" })).toEqual([]);
  });

  it("90분 초과와 비슷한 후보는 함께 나올 수 있다", () => {
    expect(evaluate([c("신촌", 40, 95), c("합정", 41, 96)]).map((n) => n.kind)).toEqual([
      "LONG_TRAVEL",
      "SIMILAR_CANDIDATES",
    ]);
  });
});
