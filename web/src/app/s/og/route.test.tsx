import { afterEach, describe, expect, it, vi } from "vitest";
import { SHARED_CASES } from "@/components/og/shared-card.cases";
import type { ResultView } from "@/lib/result/view-model";
import { toResultView } from "@/lib/result/view-model";

const loadSharedView = vi.fn<(signal: AbortSignal | undefined) => Promise<ResultView | null>>();
vi.mock("@/lib/seo/shared-preview", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/seo/shared-preview")>()),
  loadSharedView: (_state: unknown, signal?: AbortSignal) => loadSharedView(signal),
}));

/** 기본 그림 그리기를 실패시키는 스위치(정적 이미지로 가는 마지막 단계를 시험한다). */
const siteCard = { broken: false };
vi.mock("@/components/og/site-card", async (importActual) => {
  const actual = await importActual<typeof import("@/components/og/site-card")>();
  return {
    SiteCard: () => {
      if (siteCard.broken) throw new Error("그리기 실패");
      return actual.SiteCard();
    },
  };
});

/** 그린 숫자판의 반반지수 값(#202). 호출부가 숨김 가드를 거친 값을 넘기는지 본다. */
const drawn: unknown[] = [];
vi.mock("@/components/og/scoreboard-card", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/components/og/scoreboard-card")>();
  return {
    ScoreboardCard: (props: Parameters<typeof original.ScoreboardCard>[0]) => {
      drawn.push(props.data.banban);
      return original.ScoreboardCard(props);
    },
  };
});

const { GET } = await import("./route");
const URL_OK = "https://banbanyeok.app/s/og?v=2&o=ryf.4q3&m=f&t=weekday-day&dv=20261115.8";

afterEach(() => {
  vi.useRealTimers();
  loadSharedView.mockReset();
  siteCard.broken = false;
  drawn.length = 0;
});

describe("/s/og", () => {
  it("결과가 오면 링크 그림(PNG)을 하루 캐시로 준다", async () => {
    const sample = SHARED_CASES.find((c) => c.id === "four-fair");
    if (!sample) throw new Error("표본 없음");
    loadSharedView.mockResolvedValue(toResultView(sample.result));
    const response = await GET(new Request(URL_OK));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("public, max-age=86400, s-maxage=86400");
  });

  it("막 뜬 서버가 막차 표를 아직 읽는 중이면(lastTrainPending) 같은 그림을 1분만 캐시한다(곧 막차가 붙은 그림이 온다)", async () => {
    const sample = SHARED_CASES.find((c) => c.id === "two-last-train");
    if (!sample) throw new Error("표본 없음");
    const { lastTrainBasis: _basis, ...withoutTrains } = sample.result;
    const pending = {
      ...withoutTrains,
      candidates: withoutTrains.candidates.map(({ lastTrains: _trains, ...c }) => c),
      lastTrainPending: true as const,
    };
    loadSharedView.mockResolvedValue(toResultView(pending));
    const response = await GET(new Request(URL_OK));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=60");

    // 표를 다 읽은 뒤의 같은 주소는 하루 캐시다.
    loadSharedView.mockResolvedValue(toResultView(sample.result));
    expect((await GET(new Request(URL_OK))).headers.get("cache-control")).toBe("public, max-age=86400, s-maxage=86400");
  });

  it("옛 링크(v=1)는 원래 막차 줄을 그리지 않으므로 읽는 중이어도 하루 캐시다", async () => {
    const sample = SHARED_CASES.find((c) => c.id === "four-fair");
    if (!sample) throw new Error("표본 없음");
    loadSharedView.mockResolvedValue(toResultView({ ...sample.result, lastTrainPending: true }));
    const legacy = await GET(new Request("https://banbanyeok.app/s/og?v=1&o=ryf.4q3&m=f&dv=20261115.8"));
    expect(legacy.headers.get("content-type")).toBe("image/png");
    expect(legacy.headers.get("cache-control")).toBe("public, max-age=86400, s-maxage=86400");
  });

  it("서버가 예산(1.5초) 안에 답하지 않으면 서버 호출을 중단하고 기본 그림을 짧은 캐시로 준다", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let seen: AbortSignal | undefined;
    loadSharedView.mockImplementation((signal) => {
      seen = signal;
      return new Promise(() => {});
    });
    const pending = GET(new Request(URL_OK));
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toBeDefined();
    await vi.advanceTimersByTimeAsync(1499);
    expect(seen?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(seen?.aborted).toBe(true); // recommend 호출에 걸린 신호가 끊겼다
    const response = await pending;
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
  });

  it("서버 실패·잘못된 링크도 기본 그림(짧은 캐시)", async () => {
    loadSharedView.mockRejectedValue(new Error("down"));
    expect((await GET(new Request(URL_OK))).headers.get("cache-control")).toBe("public, max-age=60");
    const bad = await GET(new Request("https://banbanyeok.app/s/og?v=9"));
    expect(bad.headers.get("cache-control")).toBe("public, max-age=60");
    expect(loadSharedView).toHaveBeenCalledTimes(1); // 잘못된 링크는 서버를 부르지 않는다
  });

  it("기본 그림까지 못 그리면 500 대신 정적 기본 이미지로 302", async () => {
    siteCard.broken = true;
    loadSharedView.mockRejectedValue(new Error("down"));
    const response = await GET(new Request(URL_OK));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toMatch(/\/opengraph-image\?v=[0-9a-f]{8}$/);
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
  });

  it("반반지수(#202): 막대와 한 줄을 그린다", async () => {
    const sample = SHARED_CASES.find((c) => c.id === "four-fair");
    if (!sample) throw new Error("표본 없음");
    loadSharedView.mockResolvedValue(toResultView(sample.result));
    expect((await GET(new Request(URL_OK))).status).toBe(200);
    expect(drawn).toEqual([
      expect.objectContaining({ text: expect.stringMatching(/^가장 오래 걸리는 사람도|^걸리는 시간이/) }),
    ]);
  });
});
