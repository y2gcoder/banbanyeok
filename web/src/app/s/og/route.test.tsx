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

const { GET } = await import("./route");
const URL_OK = "https://banbanyeok.app/s/og?v=2&o=ryf.4q3&m=f&t=weekday-day&dv=20261115.8";

afterEach(() => {
  loadSharedView.mockReset();
  siteCard.broken = false;
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

  it("서버가 예산(1.5초) 안에 답하지 않으면 서버 호출을 중단하고 기본 그림을 짧은 캐시로 준다", async () => {
    let seen: AbortSignal | undefined;
    loadSharedView.mockImplementation((signal) => {
      seen = signal;
      return new Promise(() => {});
    });
    const started = Date.now();
    const response = await GET(new Request(URL_OK));
    expect(Date.now() - started).toBeLessThan(3000);
    expect(seen?.aborted).toBe(true); // recommend 호출에 걸린 신호가 끊겼다
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
    expect(response.headers.get("location")).toMatch(/\/opengraph-image$/);
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
  });
});
