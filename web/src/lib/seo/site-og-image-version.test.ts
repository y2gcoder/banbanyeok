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
  SITE_OG_IMAGE_PATH,
  SITE_OG_IMAGE_VERSION,
} from "./og-text";

const ROOT = process.cwd();

/** 사이트 기본 그림을 그리는 코드: 라우트, 카드, 공통 틀. */
const DRAWING_SOURCES = [
  "src/app/opengraph-image/route.tsx",
  "src/components/og/site-card.tsx",
  "src/components/og/frame.tsx",
];

function siteOgImageInputsHash(): string {
  const { brand, taglineTop, taglineBottom, taglineSub } = OG_TEXT;
  const digest = createHash("sha256");
  digest.update(JSON.stringify({ OG_WIDTH, OG_HEIGHT, OG_COLORS, brand, taglineTop, taglineBottom, taglineSub }));
  digest.update(readFileSync(join(ROOT, "public/fonts", OG_FONT_FILE)));
  for (const source of DRAWING_SOURCES) digest.update(readFileSync(join(ROOT, source)));
  return digest.digest("hex").slice(0, 8);
}

describe("사이트 기본 그림의 버전", () => {
  it("그림 입력이 바뀌면 SITE_OG_IMAGE_VERSION도 바뀌어 있다(카카오가 옛 그림을 캐시하지 않게)", () => {
    const expected = siteOgImageInputsHash();
    expect(
      SITE_OG_IMAGE_VERSION,
      `사이트 기본 그림의 입력이 바뀌었습니다. src/lib/seo/og-text.ts의 SITE_OG_IMAGE_VERSION을 "${expected}"로 고치세요.`,
    ).toBe(expected);
  });

  it("그림 주소는 버전을 쿼리로 붙인 경로다", () => {
    expect(SITE_OG_IMAGE_PATH).toBe(`/opengraph-image?v=${SITE_OG_IMAGE_VERSION}`);
    expect(SITE_OG_IMAGE_VERSION).toMatch(/^[0-9a-f]{8}$/);
  });
});
