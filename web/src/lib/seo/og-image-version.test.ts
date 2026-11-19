import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OG_COLORS,
  OG_FONT_FILE,
  OG_HEIGHT,
  OG_TEXT,
  OG_WIDTH,
  PAIR_OG_IMAGE_VERSION,
  SITE_OG_IMAGE_PATH,
  SITE_OG_IMAGE_VERSION,
} from "./og-text";

const ROOT = process.cwd();

type Drawn = {
  /** 이 그림에 그려지는 고정 문구(`OG_TEXT`의 키). */
  texts: (keyof typeof OG_TEXT)[];
  /** 이 그림을 그리는 코드. */
  sources: string[];
};

const SITE: Drawn = {
  texts: ["brand", "taglineTop", "taglineBottom", "taglineSub"],
  sources: ["src/app/opengraph-image/route.tsx", "src/components/og/site-card.tsx", "src/components/og/frame.tsx"],
};

/** "N분"·"N시간" 글자는 `formatMinutes`가 정하므로 그 파일도 입력이다. */
const PAIR: Drawn = {
  texts: ["brand", "pairQuestion", "pairBasis", "middleDot"],
  sources: [
    "src/app/(seo)/meet/[pair]/opengraph-image/route.tsx",
    "src/components/og/pair-card.tsx",
    "src/components/og/frame.tsx",
    "src/lib/display/minutes.ts",
  ],
};

/** 그림을 정하는 입력(문구·크기·색·글꼴 파일·그리는 코드)의 해시 앞 8자리. */
function inputsHash({ texts, sources }: Drawn): string {
  const digest = createHash("sha256");
  const fixedTexts = Object.fromEntries(texts.map((key) => [key, OG_TEXT[key]]));
  digest.update(JSON.stringify({ OG_WIDTH, OG_HEIGHT, OG_COLORS, fixedTexts }));
  digest.update(readFileSync(join(ROOT, "public/fonts", OG_FONT_FILE)));
  for (const source of sources) digest.update(readFileSync(join(ROOT, source)));
  return digest.digest("hex").slice(0, 8);
}

describe("미리보기 그림의 버전(입력이 바뀌었는데 버전이 그대로면 카카오가 옛 그림을 캐시한다)", () => {
  it("사이트 기본 그림: SITE_OG_IMAGE_VERSION", () => {
    expect(
      SITE_OG_IMAGE_VERSION,
      `사이트 기본 그림의 입력이 바뀌었습니다. src/lib/seo/og-text.ts의 SITE_OG_IMAGE_VERSION을 "${inputsHash(SITE)}"로 고치세요.`,
    ).toBe(inputsHash(SITE));
  });

  it("역 조합 그림의 고정 부분: PAIR_OG_IMAGE_VERSION", () => {
    expect(
      PAIR_OG_IMAGE_VERSION,
      `역 조합 그림의 입력이 바뀌었습니다. src/lib/seo/og-text.ts의 PAIR_OG_IMAGE_VERSION을 "${inputsHash(PAIR)}"로 고치세요.`,
    ).toBe(inputsHash(PAIR));
  });

  it("사이트 기본 그림 주소는 버전을 쿼리로 붙인 경로다", () => {
    expect(SITE_OG_IMAGE_PATH).toBe(`/opengraph-image?v=${SITE_OG_IMAGE_VERSION}`);
    expect(SITE_OG_IMAGE_VERSION).toMatch(/^[0-9a-f]{8}$/);
    expect(PAIR_OG_IMAGE_VERSION).toMatch(/^[0-9a-f]{8}$/);
  });
});
