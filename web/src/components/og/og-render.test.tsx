import { ImageResponse } from "next/og";
import { describe, expect, it } from "vitest";
import { ogFonts } from "@/lib/seo/og-font";
import { OG_HEIGHT, OG_WIDTH } from "@/lib/seo/og-text";
import { buildPairPages } from "@/lib/seo/pair-pages";
import { parseSeoPairs } from "@/lib/seo/pairs";
import fixture from "../../../fixtures/seo-pairs.json";
import { PairCard } from "./pair-card";
import { SharedCard } from "./shared-card";
import { SiteCard } from "./site-card";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

async function render(element: React.ReactElement) {
  const response = new ImageResponse(element, { width: OG_WIDTH, height: OG_HEIGHT, fonts: await ogFonts() });
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { response, bytes, view: new DataView(bytes.buffer) };
}

function expectPng({ response, bytes, view }: Awaited<ReturnType<typeof render>>) {
  expect(response.headers.get("content-type")).toBe("image/png");
  expect([...bytes.slice(0, 8)]).toEqual(PNG_SIGNATURE);
  expect(view.getUint32(16)).toBe(OG_WIDTH); // IHDR 너비
  expect(view.getUint32(20)).toBe(OG_HEIGHT);
  expect(bytes.length).toBeGreaterThan(5_000);
}

describe("OG 이미지 그리기(satori)", () => {
  const { pages } = buildPairPages(parseSeoPairs(fixture));

  it("조합 페이지 이미지는 1200×630 PNG", async () => {
    for (const page of pages) expectPng(await render(<PairCard page={page} />));
  });

  it("사이트 기본 이미지", async () => {
    expectPng(await render(<SiteCard />));
  });

  it("공유 링크 이미지: 사람 둘, 넷, 긴 역 이름", async () => {
    expectPng(
      await render(
        <SharedCard
          data={{
            stationName: "신촌",
            people: [
              { name: "나", minutes: 34 },
              { name: "지훈", minutes: 38 },
            ],
            modeLine: "공평하게 고름",
          }}
        />,
      ),
    );
    expectPng(
      await render(
        <SharedCard
          data={{
            stationName: "동대문역사문화공원",
            people: [
              { name: "나", minutes: 61 },
              { name: "친구1", minutes: 5 },
              { name: "가나다라마바사…", minutes: 0 },
              { name: "친구3", minutes: 125 },
            ],
            modeLine: "가나다라마바사… 쪽으로 고름",
          }}
        />,
      ),
    );
  });

  it("같은 내용은 같은 그림이다(정적 생성이 결정적)", async () => {
    const page = pages[0];
    if (!page) throw new Error("표본 없음");
    const [a, b] = [await render(<PairCard page={page} />), await render(<PairCard page={page} />)];
    expect(a.bytes).toEqual(b.bytes);
  });
});
