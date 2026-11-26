import { beforeEach, describe, expect, it, vi } from "vitest";
import { decodeShareQuery } from "@/lib/link/codec";
import { result, state } from "@/lib/share-card/shared-preview.fixture";
import { loadSharedView } from "./shared-preview";

const recommend = vi.fn();
vi.mock("@/lib/api/client", () => ({ recommend: (...args: unknown[]) => recommend(...args) }));

beforeEach(() => {
  recommend.mockReset();
});

describe("결과 불러오기(서버 호출)", () => {
  it("성공하면 화면 값으로", async () => {
    recommend.mockResolvedValue(result());
    const view = await loadSharedView(state);
    expect(view?.candidates[0]?.stationName).toBe("왕십리");
    expect(recommend).toHaveBeenCalledWith(
      { origins: ["1qs", "70x"], mode: "fair", favorIndex: null, nicknames: ["지훈🎂", null], timeSlot: "weekday-day" },
      expect.any(AbortSignal),
      "preview",
    );
  });

  it("옛 링크(v=1)의 미리보기는 구분 없이 요청한다(막차 시각이 실리지 않게)", async () => {
    recommend.mockResolvedValue(result());
    const legacy = decodeShareQuery("v=1&o=1qs.8jt&m=f");
    if (!legacy.ok) throw new Error("decode failed");
    const view = await loadSharedView(legacy.state);
    expect(view).not.toBeNull();
    expect(recommend).toHaveBeenCalledWith(
      {
        origins: ["1qs", "8jt"],
        mode: "fair",
        favorIndex: null,
        nicknames: null,
        timeSlot: "weekday-day",
        slotDefaulted: true,
      },
      expect.any(AbortSignal),
      "preview",
    );
    // 구분을 고른 링크는 그 표시 없이 요청한다(위 "성공하면 화면 값으로").
    recommend.mockClear();
    const chosen = decodeShareQuery("v=2&o=1qs.fkn&m=f&t=weekday-day");
    if (!chosen.ok) throw new Error("decode failed");
    await loadSharedView(chosen.state);
    expect(recommend.mock.calls[0]?.[0]).not.toHaveProperty("slotDefaulted");
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
