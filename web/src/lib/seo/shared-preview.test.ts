import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecommendResult } from "../api/types";
import { decodeShareQuery, type ShareState } from "../link/codec";
import { modeSentence } from "../result/mode-sentence";
import { toResultView } from "../result/view-model";
import { SHARED_OG_IMAGE_VERSION } from "./og-text";
import { scoreboardCardData } from "./scoreboard-card-data";
import { loadSharedView, sharedCardData, sharedImagePath, sharedPreview } from "./shared-preview";

const recommend = vi.fn();
vi.mock("../api/client", () => ({ recommend: (...args: unknown[]) => recommend(...args) }));

const state: ShareState = {
  origins: ["1qs", "70x"],
  mode: "fair",
  favorIndex: null,
  nicknames: ["지훈🎂", null],
  timeSlot: "weekday-day",
};

function result(overrides: Partial<RecommendResult> = {}): RecommendResult {
  const time = (seconds: number, transfers: number) => ({ seconds, transfers });
  return {
    status: "ok",
    mode: "fair",
    dataVersion: "20261112.6",
    timeBasis: {
      timeSlot: "weekday-day",
      requestedTimeSlot: "weekday-day",
      dayType: "weekday",
      band: "day",
      label: "평일 낮",
      holidayName: null,
    },
    participants: [
      {
        participantId: "0",
        originCode: "1qs",
        originName: "신촌",
        hidden: false,
        label: "지훈🎂",
        labelKind: "name",
        shortLabel: "지훈🎂",
      },
      {
        participantId: "1",
        originCode: "70x",
        originName: "잠실",
        hidden: false,
        label: "잠실에서 오는 분",
        labelKind: "origin",
        shortLabel: "잠실",
      },
    ],
    candidates: [
      {
        rank: 1,
        stationCode: "70x",
        stationName: "왕십리",
        times: [time(2040, 0), time(1800, 1)],
        maxSeconds: 2040,
        spreadSeconds: 240,
        totalSeconds: 3840,
        reasonCode: "FAIR_MINIMAX",
        reason: "가장 오래 걸리는 지훈🎂도 34분이에요.",
      },
    ],
    ...overrides,
  } as RecommendResult;
}

beforeEach(() => {
  recommend.mockReset();
});

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

describe("og:image 주소", () => {
  it("링크 상태 그대로에 데이터 버전을 붙여 캐시를 비켜 간다", () => {
    const path = sharedImagePath(state, "20261112.6");
    expect(path.startsWith("/s/og?v=2&o=1qs.70x&m=f&t=weekday-day&n=")).toBe(true);
    expect(path.endsWith(`&dv=20261112.6&iv=${SHARED_OG_IMAGE_VERSION}`)).toBe(true);
  });

  it("그림 디자인 버전(iv)이 주소에 든다: 디자인이 바뀌면 같은 결과도 새 주소가 된다(카카오 캐시를 비켜 간다)", () => {
    expect(sharedImagePath(state, "1")).toMatch(/&iv=[0-9a-f]{8}$/);
    expect(sharedImagePath(state, "1")).toContain(`iv=${SHARED_OG_IMAGE_VERSION}`);
  });

  it("옛 공유 링크(v=1)와 새 링크(v=2)의 쿼리 모두 같은 그림 주소 규칙에서 읽힌다(iv·dv는 무시)", () => {
    const legacy: ShareState = { ...state, nicknames: null };
    const v1 = decodeShareQuery("v=1&o=1qs.70x&m=f&iv=abcdef01&dv=1");
    expect(v1).toEqual({ ok: true, state: legacy });
    expect(decodeShareQuery("v=2&o=1qs.70x&m=f&t=weekday-day&iv=abcdef01&dv=1")).toEqual({ ok: true, state: legacy });
  });

  it("그 주소의 쿼리를 링크 코덱이 그대로 읽는다(dv는 무시)", () => {
    const query = sharedImagePath(state, "20261112.6").split("?")[1] ?? "";
    expect(decodeShareQuery(query)).toEqual({ ok: true, state });
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

describe("결과 불러오기(서버 호출)", () => {
  it("성공하면 화면 값으로", async () => {
    recommend.mockResolvedValue(result());
    const view = await loadSharedView(state);
    expect(view?.candidates[0]?.stationName).toBe("왕십리");
    expect(recommend).toHaveBeenCalledWith(
      { origins: ["1qs", "70x"], mode: "fair", favorIndex: null, nicknames: ["지훈🎂", null], timeSlot: "weekday-day" },
      expect.any(AbortSignal),
    );
  });

  it("부른 쪽의 중단 신호(/s/og 시간 예산)가 서버 호출에도 걸린다", async () => {
    let seen: AbortSignal | undefined;
    recommend.mockImplementation((_query: unknown, signal: AbortSignal) => {
      seen = signal;
      return new Promise(() => {});
    });
    const controller = new AbortController();
    const pending = loadSharedView({ ...state, origins: ["1qs", "k3a"] }, controller.signal);
    await vi.waitFor(() => expect(seen).toBeDefined());
    expect(seen?.aborted).toBe(false);
    controller.abort();
    expect(seen?.aborted).toBe(true);
    void pending;
  });

  it("링크와 다른 기준(평일 낮 대체)으로 계산된 결과는 null — 틀린 기준의 미리보기를 메신저 캐시에 남기지 않는다", async () => {
    recommend.mockResolvedValue(
      result({
        timeBasis: {
          timeSlot: "weekday-day",
          requestedTimeSlot: "saturday-night",
          dayType: "weekday",
          band: "day",
          label: "평일 낮",
          holidayName: null,
        },
      }),
    );
    expect(await loadSharedView({ ...state, timeSlot: "saturday-night", origins: ["1qs", "2je"] })).toBeNull();
  });

  it("실패하거나 시간이 지나면 null — 호출한 쪽이 기본 미리보기로 대체한다", async () => {
    recommend.mockImplementation(() => {
      throw new Error("연결 실패");
    });
    expect(await loadSharedView({ ...state, origins: ["1qs", "dxy"] })).toBeNull();
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
