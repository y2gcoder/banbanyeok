import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SHARED_CASES } from "@/components/og/shared-card.cases";
import { decodeShareQuery } from "@/lib/link/codec";
import { sharePath } from "@/lib/result/share-url";

/**
 * 옛 링크(v=1)는 요일·시간대를 고른 적이 없다. 그 링크에서 나가는 추천 요청은 어느 길로 가든 `timeSlot`을 싣지 않아야 한다(서버가
 * 요일을 모르는 요청으로 보고 귀갓길 막차 시각을 내지 않는다). PR #81 둘째 검토: 메타데이터가 만든 그림 주소가 `v=2&t=weekday-day`로
 * 바뀌어, 그림을 그리는 요청만 평일 낮을 "고른" 요청이 됐다. 여기서는 서버 호출만 가로채고 나머지는 실제 코드를 그대로 탄다:
 * 링크 → 메타데이터(`generateMetadata`) → 그림 주소 → 그림 경로(`/s/og`의 GET) → 실제 POST 본문.
 */
const sample = SHARED_CASES.find((c) => c.id === "two-even-middle");
if (!sample) throw new Error("표본 없음");

const bodies: Record<string, unknown>[] = [];

beforeEach(() => {
  bodies.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      expect(new URL(request.url).pathname).toBe("/v1/recommend");
      bodies.push((await request.clone().json()) as Record<string, unknown>);
      return Response.json(sample.result);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const { generateMetadata } = await import("./page");
const { GET } = await import("./og/route");

function imageUrl(metadata: Awaited<ReturnType<typeof generateMetadata>>): string {
  const images = metadata.openGraph?.images;
  const first = Array.isArray(images) ? images[0] : images;
  if (!first || typeof first !== "object" || !("url" in first)) throw new Error("og:image 없음");
  return String(first.url);
}

describe("옛 링크(v=1)에서 나가는 요청", () => {
  it("메타데이터도, 그 메타데이터가 가리키는 그림도 구분 없이 요청한다", async () => {
    const metadata = await generateMetadata({ searchParams: Promise.resolve({ v: "1", o: "dzc.ry7", m: "f" }) });
    // 링크 미리보기의 제목·설명을 만드는 요청.
    expect(bodies).toEqual([{ origins: ["dzc", "ry7"], mode: "fair" }]);

    // 그림 주소는 링크의 버전을 그대로 싣는다: v=1이고 `t`가 없다.
    const image = imageUrl(metadata);
    const url = new URL(image, "https://banbanyeok.app");
    expect(url.pathname).toBe("/s/og");
    expect(url.searchParams.get("v")).toBe("1");
    expect(url.searchParams.has("t")).toBe(false);
    expect(image.startsWith(`/s/og?v=1&o=dzc.ry7&m=f&dv=${sample.result.dataVersion}&iv=`)).toBe(true);

    // 크롤러가 그 주소로 그림을 받을 때 나가는 요청.
    const response = await GET(new Request(url));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual({ origins: ["dzc", "ry7"], mode: "fair" });
    for (const body of bodies) expect(body).not.toHaveProperty("timeSlot");
  });

  it("그 결과를 다시 공유한 링크도 v=1이다(받는 사람의 요청에도 구분이 없다)", async () => {
    const decoded = decodeShareQuery("v=1&o=dzc.ry7&m=q&n=66-87IiY.7KeA7Jew");
    if (!decoded.ok) throw new Error("decode failed");
    const shared = sharePath(decoded.state);
    expect(shared).toBe("/s?v=1&o=dzc.ry7&m=q&n=66-87IiY.7KeA7Jew");
    const search = Object.fromEntries(new URL(shared, "https://banbanyeok.app").searchParams);
    await generateMetadata({ searchParams: Promise.resolve(search) });
    expect(bodies).toEqual([{ origins: ["dzc", "ry7"], mode: "fast", nicknames: ["민수", "지연"] }]);
  });

  it("구분을 고른 링크(v=2)는 메타데이터와 그림 모두 그 구분을 보낸다", async () => {
    const search = { v: "2", o: "dzc.ry7", m: "f", t: "weekday-day" };
    const metadata = await generateMetadata({ searchParams: Promise.resolve(search) });
    const image = imageUrl(metadata);
    expect(image.startsWith("/s/og?v=2&o=dzc.ry7&m=f&t=weekday-day&dv=")).toBe(true);
    await GET(new Request(new URL(image, "https://banbanyeok.app")));
    expect(bodies).toEqual([
      { origins: ["dzc", "ry7"], mode: "fair", timeSlot: "weekday-day" },
      { origins: ["dzc", "ry7"], mode: "fair", timeSlot: "weekday-day" },
    ]);
  });
});
