import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { describe, expect, it } from "vitest";
import { toResultView } from "@/lib/result/view-model";
import { ogFonts } from "@/lib/seo/og-font";
import { OG_HEIGHT, OG_WIDTH } from "@/lib/seo/og-text";
import { buildPairPages } from "@/lib/seo/pair-pages";
import { parseSeoPairs } from "@/lib/seo/pairs";
import { sharedCardData, sharedPreview } from "@/lib/seo/shared-preview";
import fixture from "../../../fixtures/seo-pairs.json";
import { PairCard } from "./pair-card";
import { SharedCard } from "./shared-card";
import { HIDDEN_ORIGIN, SHARED_CASES } from "./shared-card.cases";
import { SiteCard } from "./site-card";

/** 있으면 공유 링크 그림을 이 폴더에 PNG로 남긴다(PR 화면 캡처용: OG_SCREENS_DIR=../docs/setup/v1-screens pnpm exec vitest run og-render). */
const screensDir = process.env.OG_SCREENS_DIR;

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

  it("공유 링크 이미지: 정해 둔 경우 전부(2·3·4명, 긴 별칭, 숨김, 같은 역, 0분, 빠른·누구 쪽으로, 기준 문구, 긴 역 이름, 1시간 넘음)", async () => {
    for (const c of SHARED_CASES) {
      const view = toResultView(c.result);
      const data = sharedCardData(view, c.state);
      if (!data) throw new Error(`${c.id}: 그림 데이터 없음`);
      // 숨긴 출발역은 그림 값·미리보기 설명 어디에도 없다(입력에 본인 시점의 출발역 이름이 들어 있어도: hidden-self-view).
      expect(JSON.stringify([data, sharedPreview(view, c.state)])).not.toContain(HIDDEN_ORIGIN);
      const drawn = await render(<SharedCard data={data} />);
      expectPng(drawn);
      if (screensDir) writeFileSync(join(screensDir, `og-${c.id}.png`), drawn.bytes);
    }
  });

  it("숨긴 사람 본인 시점처럼 입력에 숨긴 출발역 이름이 있어도 그림 값·미리보기 설명에는 '참가자 N'만 나온다", () => {
    const c = SHARED_CASES.find((x) => x.id === "hidden-self-view");
    if (!c) throw new Error("표본 없음");
    expect(JSON.stringify(c.result)).toContain(HIDDEN_ORIGIN); // 입력에는 있다(본인에게만 오는 originName)
    const view = toResultView(c.result);
    const data = sharedCardData(view, c.state);
    const preview = sharedPreview(view, c.state);
    expect(data?.people.map((p) => p.name)).toEqual(["강남", "참가자 2", "홍대입구"]);
    expect(data?.modeLine).toBe("참가자 2 쪽으로 고름");
    expect(preview?.description).toBe("강남 5분 · 참가자 2 4분 · 홍대입구 35분 · 참가자 2 쪽으로 고름");
    expect(JSON.stringify([data, preview])).not.toContain(HIDDEN_ORIGIN);
  });

  it("같은 내용은 같은 그림이다(정적 생성이 결정적)", async () => {
    const page = pages[0];
    if (!page) throw new Error("표본 없음");
    const [a, b] = [await render(<PairCard page={page} />), await render(<PairCard page={page} />)];
    expect(a.bytes).toEqual(b.bytes);
  });
});
