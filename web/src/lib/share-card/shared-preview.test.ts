import { describe, expect, it } from "vitest";
import type { RecommendResult } from "@/lib/api/types";
import type { ShareState } from "@/lib/link/codec";
import { modeSentence } from "@/lib/result/mode-sentence";
import { toResultView } from "@/lib/result/view-model";
import { scoreboardCardData } from "./scoreboard-card-data";
import { sharedCardData, sharedPreview } from "./shared-preview";
import { result, state } from "./shared-preview.fixture";

describe("공유 링크 미리보기 문구", () => {
  const view = toResultView(result());

  it("제목은 제안하는 말투, 설명은 각자 시간과 모드", () => {
    expect(sharedPreview(view, state)).toEqual({
      title: "왕십리에서 볼까?",
      // 미리보기는 좁은 칸이라 짧은 이름(shortLabel): "잠실에서 오는 분" 대신 "잠실"
      description: "지훈🎂 34분 · 잠실 30분 · 공평하게 고름",
    });
  });

  it("모드 문장", () => {
    expect(modeSentence("fair", null)).toBe("공평하게 고름");
    expect(modeSentence("fast", null)).toBe("가장 빠른 만남으로 고름");
    expect(modeSentence("favor", "민수")).toBe("민수 쪽으로 고름");
  });

  it("후보가 없으면 미리보기를 만들지 않는다", () => {
    const empty = toResultView(result({ candidates: [], status: "no_common_candidate" }));
    expect(sharedPreview(empty, state)).toBeNull();
    expect(sharedCardData(empty, state)).toBeNull();
  });
});

describe("이미지에 그릴 값", () => {
  it("글꼴에 없는 글자는 거르고, 비면 순번 이름을 쓴다", () => {
    const base = result();
    const emojiOnly = {
      ...base.participants[1],
      label: "🎉",
      labelKind: "name",
      shortLabel: "🎉",
    } as RecommendResult["participants"][number];
    const withEmoji = toResultView({ ...base, participants: [base.participants[0], emojiOnly] } as RecommendResult);
    const data = sharedCardData(withEmoji, { ...state, nicknames: ["지훈🎂", "🎉"] });
    expect(data?.people.map((p) => p.name)).toEqual(["지훈", "참가자 2"]);
    expect(data?.people.map((p) => p.minutes)).toEqual([34, 30]);
    expect(data?.stationName).toBe("왕십리");
    expect(data?.modeLine).toBe("공평하게 고름");
  });

  it("배려 모드는 우대 대상 이름(걸러진 이름)을 문장에 쓴다", () => {
    const favorState: ShareState = { ...state, mode: "favor", favorIndex: 0, nicknames: ["지훈🎂", null] };
    const view = toResultView(result({ mode: "favor" }));
    expect(sharedCardData(view, favorState)?.modeLine).toBe("지훈 쪽으로 고름");
    expect(sharedPreview(view, favorState)?.description).toContain("지훈🎂 쪽으로 고름");
  });
});

describe("계산 기준", () => {
  it("평일 낮이 아니면 설명과 그림에 기준을 덧붙이고, 평일 낮은 옛 문구 그대로다", () => {
    const night = toResultView(
      result({
        timeBasis: {
          timeSlot: "saturday-night",
          requestedTimeSlot: "saturday-night",
          dayType: "saturday",
          band: "night",
          label: "토요일 밤",
          holidayName: null,
        },
      }),
    );
    expect(sharedPreview(night, state)?.description.endsWith(" · 공평하게 고름 · 토요일 밤 기준")).toBe(true);
    expect(sharedCardData(night, state)?.modeLine).toBe("공평하게 고름 · 토요일 밤 기준");
    const day = toResultView(result());
    expect(sharedPreview(day, state)?.description.endsWith(" · 공평하게 고름")).toBe(true);
  });
});

describe("지도 한가운데 비교(#68)", () => {
  /** 신촌 34분·잠실 30분(1위 왕십리) 대신 지도 한가운데 역에서 각자 40분·35분이면 지훈이 6분 더 걸린다(최장 34 → 40). */
  const withMiddle = (seconds: [number, number], overrides: Partial<RecommendResult> = {}) =>
    result({
      mapMiddle: {
        stationCode: "3k5",
        stationName: "한강진",
        times: [
          { participantId: "0", seconds: seconds[0], transfers: 1 },
          { participantId: "1", seconds: seconds[1], transfers: 1 },
        ],
      },
      ...overrides,
    });

  it("설명(og:description) 끝에 비교 문장이 붙는다", () => {
    const view = toResultView(withMiddle([2400, 2100]));
    expect(sharedPreview(view, state)?.description).toBe(
      "지훈🎂 34분 · 잠실 30분 · 공평하게 고름 · 지도 한가운데인 한강진역이면 지훈🎂은 6분 더 걸려요",
    );
  });

  it("짧은 이름이면 이름으로 부른다", () => {
    const view = toResultView(withMiddle([2040, 2400]));
    expect(sharedPreview(view, state)?.description.endsWith("지도 한가운데인 한강진역이면 잠실은 10분 더 걸려요")).toBe(
      true,
    );
  });

  it("mapMiddle이 없는 응답(옛 서버·조건 미달)은 문구가 그대로다", () => {
    const view = toResultView(result());
    expect(view.mapMiddle).toBeNull();
    expect(sharedPreview(view, state)?.description).toBe("지훈🎂 34분 · 잠실 30분 · 공평하게 고름");
    expect(scoreboardCardData(view, state)?.compareLine).toBeNull();
  });

  it("그림 값: 숫자판에는 차이·칭호·비교 문장(글꼴에 있는 글자로 거른 이름)이 든다", () => {
    const view = toResultView(withMiddle([2040, 2400]));
    const data = scoreboardCardData(view, state);
    expect(data?.spread).toBe(4);
    expect(data?.title).toBeNull();
    expect(data?.compareLine).toBe("지도 한가운데인 한강진역이면 잠실은 10분 더 걸려요");
    // 이모지가 걸러진 이름("지훈")으로 문장을 만든다.
    const jihun = scoreboardCardData(toResultView(withMiddle([2700, 2100])), state);
    expect(jihun?.compareLine).toBe("지도 한가운데인 한강진역이면 지훈은 11분 더 걸려요");
  });

  it("공평 기준이 아니면 비교도 칭호도 없다", () => {
    const view = toResultView(withMiddle([2400, 2100], { mode: "fast" }));
    expect(view.mapMiddle).toBeNull();
    expect(scoreboardCardData(view, { ...state, mode: "fast" })?.compareLine).toBeNull();
  });

  it("출발역을 숨긴 참가자가 있으면 비교가 없다(숨긴 출발역을 거꾸로 짐작할 수 있다)", () => {
    const base = withMiddle([2400, 2100]);
    const [first, second] = base.participants;
    if (!first || !second) throw new Error("표본");
    const hidden = toResultView({ ...base, participants: [first, { ...second, hidden: true, originName: null }] });
    expect(hidden.mapMiddle).toBeNull();
    expect(sharedPreview(hidden, state)?.description).not.toContain("지도 한가운데");
  });

  it("차이가 아주 작을 때만 칭호: 2명은 1분 이하", () => {
    const even = toResultView(
      result({
        candidates: [
          {
            ...result().candidates[0],
            times: [
              { participantId: "0", seconds: 1800, transfers: 0 },
              { participantId: "1", seconds: 1860, transfers: 0 },
            ],
          },
        ],
      } as Partial<RecommendResult>),
    );
    expect(scoreboardCardData(even, state)?.title).toBe("완벽한 반반");
    expect(scoreboardCardData(toResultView(result()), state)?.title).toBeNull();
  });
});
