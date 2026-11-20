import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { toResultView } from "@/lib/result/view-model";
import {
  OG_COLORS,
  OG_FONT_FILE,
  OG_HEIGHT,
  OG_NAME_MAX,
  OG_TEXT,
  OG_WIDTH,
  PAIR_OG_IMAGE_VERSION,
  SHARED_OG_IMAGE_VERSION,
  SITE_OG_IMAGE_PATH,
  SITE_OG_IMAGE_VERSION,
} from "@/lib/seo/og-text";
import { scoreboardCardData } from "@/lib/seo/scoreboard-card-data";
import { ScoreboardCard } from "./scoreboard-card";
import { SHARED_CASES } from "./shared-card.cases";

const ROOT = process.cwd();

type Drawn = {
  /** 이 그림에 그려지는 고정 문구(`OG_TEXT`의 키). */
  texts: (keyof typeof OG_TEXT)[];
  /** 이 그림을 그리는 코드. */
  sources: string[];
  /** 그림을 바꾸는 그 밖의 상수(`OG_TEXT`가 아닌 것: 이름 말줄임 길이 등). */
  constants?: Record<string, unknown>;
  /** 대표 표본을 실제로 그린 결과(마크업). 상수·규칙·코드 어디를 바꿨든 그림이 달라지면 해시가 달라진다. */
  rendered?: () => string[];
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

/**
 * 공유 링크 그림 대표 표본(2·3·4명, 긴 별칭 4인, 1시간 넘음, 칭호·기준 칩 포함)을 그린 마크업. 이름 말줄임(`OG_NAME_MAX`)·칭호 임계값·
 * 비교 문장 6자 규칙처럼 코드 밖 상수나 규칙이 바뀌어 그림이 달라지는 경우를 해시 입력에 목록을 빠뜨려도 잡는다.
 * 표본은 `shared-card.cases.ts`에서 고른다(그 값이나 이 목록을 바꿔도 해시가 달라지므로 버전을 함께 올린다).
 */
const SAMPLE_IDS = [
  "two-even-middle",
  "two-middle-saturday",
  "three-middle",
  "four-middle-long-name",
  "three-middle-over-hour",
  "nickname-hidden",
  "four-fair",
];

function renderedSharedSamples(): string[] {
  return SAMPLE_IDS.map((id) => {
    const found = SHARED_CASES.find((c) => c.id === id);
    if (!found) throw new Error(`표본 없음: ${id}`);
    const data = scoreboardCardData(toResultView(found.result), found.state);
    if (!data) throw new Error(`그림 값 없음: ${id}`);
    return renderToStaticMarkup(createElement(ScoreboardCard, { data }));
  });
}

/**
 * 공유 링크 그림 "A 숫자판"(`/s/og`). 그림 값을 만드는 코드(이름 거르기·칭호·문장 규칙)도 입력이다. 그림에는 역 이름·시간처럼 결과마다
 * 다른 값이 들어가지만 그건 주소의 나머지(`o`·`m`·`t`·`n`·`dv`)가 이미 가른다. 방 미리보기(`/r/og`)는 `SharedCard`라 이 버전과 상관없다.
 */
const SHARED: Drawn = {
  texts: [
    "brand",
    "sharedSuffix",
    "noRoute",
    "spreadPrefix",
    "zeroMinutes",
    "modeFair",
    "modeFast",
    "modeFavorSuffix",
    "ellipsis",
    "middleDot",
    "basisSuffix",
    "evenTitle",
    "middleLead",
    "middleIf",
    "middleMore",
    "middleLongest",
  ],
  constants: { OG_NAME_MAX },
  rendered: renderedSharedSamples,
  sources: [
    "src/app/s/og/route.tsx",
    "src/components/og/scoreboard-card.tsx",
    "src/components/og/frame.tsx",
    "src/lib/seo/scoreboard-card-data.ts",
    "src/lib/seo/shared-preview.ts",
    "src/lib/seo/og-coverage.ts",
    "src/lib/result/map-middle.ts",
    "src/lib/result/mode-sentence.ts",
    "src/lib/display/korean.ts",
    "src/lib/display/minutes.ts",
  ],
};

/** 그림을 정하는 입력(문구·크기·색·글꼴 파일·그리는 코드)의 해시 앞 8자리. */
function inputsHash({ texts, sources, constants, rendered }: Drawn): string {
  const digest = createHash("sha256");
  const fixedTexts = Object.fromEntries(texts.map((key) => [key, OG_TEXT[key]]));
  digest.update(JSON.stringify({ OG_WIDTH, OG_HEIGHT, OG_COLORS, fixedTexts, constants }));
  for (const markup of rendered?.() ?? []) digest.update(markup);
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

  it("공유 링크 그림(숫자판): SHARED_OG_IMAGE_VERSION", () => {
    expect(
      SHARED_OG_IMAGE_VERSION,
      `공유 링크 그림의 입력이 바뀌었습니다. src/lib/seo/og-text.ts의 SHARED_OG_IMAGE_VERSION을 "${inputsHash(SHARED)}"로 고치세요.`,
    ).toBe(inputsHash(SHARED));
  });

  it("공유 링크 그림이 그리는 문구 목록에 빠진 키가 없다(그림 코드가 OG_TEXT를 쓰는 만큼 적는다)", () => {
    const code = readFileSync(join(ROOT, "src/components/og/scoreboard-card.tsx"), "utf8");
    const used = [...code.matchAll(/OG_TEXT\.(\w+)/g)].map((m) => m[1]);
    for (const key of used) expect(SHARED.texts, `scoreboard-card.tsx가 OG_TEXT.${key}를 쓴다`).toContain(key);
  });

  it("사이트 기본 그림 주소는 버전을 쿼리로 붙인 경로다", () => {
    expect(SITE_OG_IMAGE_PATH).toBe(`/opengraph-image?v=${SITE_OG_IMAGE_VERSION}`);
    expect(SITE_OG_IMAGE_VERSION).toMatch(/^[0-9a-f]{8}$/);
    expect(PAIR_OG_IMAGE_VERSION).toMatch(/^[0-9a-f]{8}$/);
    expect(SHARED_OG_IMAGE_VERSION).toMatch(/^[0-9a-f]{8}$/);
  });
});
