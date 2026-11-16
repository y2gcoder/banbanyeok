import { afterEach, describe, expect, it, vi } from "vitest";
import { SHARED_CASES } from "@/components/og/shared-card.cases";
import type { ResultView } from "@/lib/result/view-model";
import { toResultView } from "@/lib/result/view-model";

const loadSharedView = vi.fn<() => Promise<ResultView | null>>();
vi.mock("@/lib/seo/shared-preview", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/seo/shared-preview")>()),
  loadSharedView: () => loadSharedView(),
}));

const { GET } = await import("./route");
const URL_OK = "https://banbanyeok.app/s/og?v=2&o=ryf.4q3&m=f&t=weekday-day&dv=20261115.8";

afterEach(() => {
  loadSharedView.mockReset();
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

  it("서버가 예산(1.5초) 안에 답하지 않으면 기본 그림을 짧은 캐시로 준다", async () => {
    loadSharedView.mockReturnValue(new Promise(() => {}));
    const started = Date.now();
    const response = await GET(new Request(URL_OK));
    expect(Date.now() - started).toBeLessThan(3000);
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
});
