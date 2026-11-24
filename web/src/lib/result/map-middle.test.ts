import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { RecommendResult } from "@/lib/api/types";
import { minutesFromSeconds } from "@/lib/display/minutes";
import { evenTitle, MIDDLE_MIN_EXTRA, middleSentence, middleView, toMapMiddleView } from "./map-middle";

type Input = Parameters<typeof toMapMiddleView>[0];

function input(
  seconds: number[],
  overrides: { mode?: RecommendResult["mode"]; hidden?: boolean[]; code?: string } = {},
): Input {
  return {
    mode: overrides.mode ?? "fair",
    participants: seconds.map((_, i) => ({ participantId: String(i), hidden: overrides.hidden?.[i] ?? false })),
    mapMiddle: {
      stationCode: overrides.code ?? "mid",
      stationName: "한강진",
      times: seconds.map((s, i) => ({ participantId: String(i), seconds: s, transfers: 1 })),
    },
  } as Input;
}

const TOP = { stationCode: "top", minutes: [21, 21] };

describe("toMapMiddleView", () => {
  it("보일 조건을 모두 채우면 사람별 분·가장 오래·가장 오래 걸리는 사람과 늘어난 분을 준다", () => {
    expect(toMapMiddleView(input([1380, 2100]), TOP)).toEqual({
      stationCode: "mid",
      stationName: "한강진",
      minutes: [23, 35],
      max: 35,
      personIndex: 1,
      extra: 14,
    });
  });

  it("공평 기준이 아니면 없다", () => {
    expect(toMapMiddleView(input([1380, 2100], { mode: "fast" }), TOP)).toBeNull();
    expect(toMapMiddleView(input([1380, 2100], { mode: "favor" }), TOP)).toBeNull();
  });

  it("출발역을 숨긴 사람이 한 명이라도 있으면 없다", () => {
    expect(toMapMiddleView(input([1380, 2100], { hidden: [false, true] }), TOP)).toBeNull();
    expect(toMapMiddleView(input([1380, 2100], { hidden: [true, false] }), TOP)).toBeNull();
  });

  it("서버가 값을 주지 않았거나 1위 추천 역과 같으면 없다", () => {
    expect(toMapMiddleView({ mode: "fair", participants: input([1380, 2100]).participants }, TOP)).toBeNull();
    expect(toMapMiddleView(input([1380, 2100], { code: "top" }), TOP)).toBeNull();
  });

  it("사람 수가 맞지 않으면 없다", () => {
    expect(toMapMiddleView(input([1380, 2100, 2000]), TOP)).toBeNull();
  });

  it(`가장 오래가 ${MIDDLE_MIN_EXTRA}분 이상 늘 때만(보이는 분 기준): 5분은 보이고 4분은 숨긴다`, () => {
    // 추천 역 최장 21분. 지도 한가운데 최장 26분(1560초)이면 5분 → 보인다. 25분 29초(1529초)는 25분이라 4분 → 숨긴다.
    expect(toMapMiddleView(input([1200, 1560]), TOP)).not.toBeNull();
    expect(toMapMiddleView(input([1200, 1529]), TOP)).toBeNull();
    expect(toMapMiddleView(input([1200, 1530]), TOP)).not.toBeNull(); // 25분 30초는 올림해 26분
  });

  it("가장 오래 걸리는 사람이 같으면 추천 역보다 더 늘어난 사람(그래도 같으면 앞선 사람)", () => {
    const view = toMapMiddleView(input([1800, 1800]), { stationCode: "top", minutes: [20, 18] });
    expect(view?.personIndex).toBe(1); // 둘 다 30분: 0번은 10분, 1번은 12분 늘었다
    expect(view?.extra).toBe(12);
    const tied = toMapMiddleView(input([1800, 1800]), { stationCode: "top", minutes: [20, 20] });
    expect(tied?.personIndex).toBe(0);
  });
});

/** 서버 MapMiddleRule과 같이 쓰는 벡터(계약 원본을 직접 읽는다). */
const shared = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../../../../contracts/golden/display-minutes.json"), "utf8"),
) as {
  mapMiddle: {
    minExtraMinutes: number;
    vectors: { id: string; middleSeconds: number[]; topSeconds: number[]; shown: boolean }[];
  };
};

describe("지도 한가운데 최소 차이 — contracts/golden/display-minutes.json", () => {
  it("값이 서버와 같은 원본에서 온다", () => {
    expect(MIDDLE_MIN_EXTRA).toBe(shared.mapMiddle.minExtraMinutes);
  });

  it.each(shared.mapMiddle.vectors.map((v) => [v.id, v] as const))("%s", (_id, vector) => {
    const view = middleView(
      { stationCode: "mid", stationName: "가운데", times: vector.middleSeconds.map((seconds) => ({ seconds })) },
      { stationCode: "top", minutes: vector.topSeconds.map(minutesFromSeconds) },
    );
    expect(view !== null).toBe(vector.shown);
  });
});

describe("evenTitle", () => {
  it("2명은 차이 1분 이하, 3~4명은 2분 이하일 때만", () => {
    expect(evenTitle("fair", 0, 2)).toBe("완벽한 반반");
    expect(evenTitle("fair", 1, 2)).toBe("완벽한 반반");
    expect(evenTitle("fair", 2, 2)).toBeNull();
    expect(evenTitle("fair", 2, 3)).toBe("완벽한 반반");
    expect(evenTitle("fair", 3, 3)).toBeNull();
    expect(evenTitle("fair", 2, 4)).toBe("완벽한 반반");
    expect(evenTitle("fair", 3, 4)).toBeNull();
  });

  it("공평 기준이 아니면 붙이지 않는다", () => {
    expect(evenTitle("fast", 0, 2)).toBeNull();
    expect(evenTitle("favor", 0, 3)).toBeNull();
  });
});

describe("middleSentence", () => {
  const middle = { stationName: "한강진", extra: 14 };

  it("받침에 맞는 조사로 이름을 부른다", () => {
    expect(middleSentence(middle, "잠실")).toBe("지도 한가운데인 한강진역이면 잠실은 14분 더 걸려요");
    expect(middleSentence(middle, "혜화")).toBe("지도 한가운데인 한강진역이면 혜화는 14분 더 걸려요");
  });

  it("이름이 6자를 넘으면 '가장 오래 걸리는 사람'으로 쓴다(6자는 그대로)", () => {
    expect(middleSentence(middle, "여섯글자이름")).toBe("지도 한가운데인 한강진역이면 여섯글자이름은 14분 더 걸려요");
    expect(middleSentence(middle, "일곱글자이름이")).toBe(
      "지도 한가운데인 한강진역이면 가장 오래 걸리는 사람은 14분 더 걸려요",
    );
  });

  it("'역'으로 끝나는 이름은 한 번만, 한 시간이 넘으면 시간으로 쓴다", () => {
    expect(middleSentence({ stationName: "서울역", extra: 65 }, "민수")).toBe(
      "지도 한가운데인 서울역이면 민수는 1시간 5분 더 걸려요",
    );
  });

  it("'손해'·'억울'·'AI'처럼 친구에게 가는 문구에 쓰지 않는 말이 없다", () => {
    const text = middleSentence(middle, "잠실");
    for (const word of ["손해", "억울", "AI"]) expect(text).not.toContain(word);
  });
});
