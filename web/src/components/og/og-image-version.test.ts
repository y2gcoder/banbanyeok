import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { toResultView } from "@/lib/result/view-model";
import { ROOM_PREVIEW_LAST_TRAIN, roomShareCopy } from "@/lib/room/share-copy";
import { roomImagePath } from "@/lib/room/share-link";
import {
  OG_COLORS,
  OG_FONT_FILE,
  OG_HEIGHT,
  OG_NAME_MAX,
  OG_TEXT,
  OG_WIDTH,
  PAIR_OG_IMAGE_VERSION,
  ROOM_OG_IMAGE_VERSION,
  SHARED_OG_IMAGE_VERSION,
  SITE_OG_IMAGE_PATH,
  SITE_OG_IMAGE_VERSION,
} from "@/lib/seo/og-text";
import { scoreboardCardData } from "@/lib/seo/scoreboard-card-data";
import { ROOM_CASES } from "./room-card.cases";
import { ScoreboardCard } from "./scoreboard-card";
import { SharedCard } from "./shared-card";
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
  "two-last-train",
  "four-last-train-middle",
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
 * 다른 값이 들어가지만 그건 주소의 나머지(`o`·`m`·`t`·`n`·`dv`)가 이미 가른다. 방 미리보기(`/r/og`)는 `SharedCard`라 아래 `ROOM`이 따로 센다.
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
    "lastTrain",
    "lastTrainBy",
    "nextDay",
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
    "src/lib/result/last-train.ts",
    "src/lib/result/mode-sentence.ts",
    "src/lib/display/korean.ts",
    "src/lib/display/minutes.ts",
  ],
};

/**
 * 방 미리보기 그림 표본(결과·정한 역·4명·새벽 약속)을 서버 미리보기에서 그림 값까지 만들어 그린 마크업. 실제 경로와 같이 기본값으로
 * 그린다: 막차 줄 스위치(`ROOM_PREVIEW_LAST_TRAIN`)가 꺼져 있으면 막차 줄 없는 그림이 버전의 기준이고, 켜면 마크업이 달라져 버전이 바뀐다.
 */
function renderedRoomSamples(): string[] {
  return ROOM_CASES.map(({ id, preview }) => {
    const card = roomShareCopy(preview).card;
    if (!card) throw new Error(`그림 값 없음: ${id}`);
    return renderToStaticMarkup(createElement(SharedCard, { data: card }));
  });
}

/**
 * 방 미리보기 그림(`/r/<id>/og`, 노선 그림 `SharedCard`). 그림 값은 `roomShareCopy`가 서버 미리보기에서 만든다(이름 거르기·기준 문장·
 * 약속 문구·막차 줄). 방마다 다른 값(역·시간·사람)은 주소의 `sv`·`dv`가 가르고, 이 버전은 같은 방 내용을 다르게 그리게 되는 변화를 가른다.
 */
const ROOM: Drawn = {
  texts: [
    "brand",
    "sharedSuffix",
    "decidedSuffix",
    "decidedBy",
    "noRoute",
    "longestPrefix",
    "spreadPrefix",
    "zeroMinutes",
    "modeFair",
    "modeFast",
    "modeFavorSuffix",
    "ellipsis",
    "middleDot",
    "basisSuffix",
    "lastTrain",
    "lastTrainBy",
    "nextDay",
  ],
  constants: { OG_NAME_MAX, ROOM_PREVIEW_LAST_TRAIN },
  rendered: renderedRoomSamples,
  sources: [
    "src/app/r/[roomId]/og/route.tsx",
    "src/components/og/shared-card.tsx",
    "src/components/og/frame.tsx",
    "src/lib/room/share-copy.ts",
    "src/lib/room/dates.ts",
    "src/lib/seo/og-coverage.ts",
    "src/lib/result/last-train.ts",
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

  it("방 미리보기 그림: ROOM_OG_IMAGE_VERSION", () => {
    expect(
      ROOM_OG_IMAGE_VERSION,
      `방 미리보기 그림의 입력이 바뀌었습니다. src/lib/seo/og-text.ts의 ROOM_OG_IMAGE_VERSION을 "${inputsHash(ROOM)}"로 고치세요.`,
    ).toBe(inputsHash(ROOM));
  });

  it("방 미리보기 그림의 버전은 막차 줄 스위치의 지금 상태로 센다(켜거나 끄면 버전이 바뀐다)", () => {
    const flipped = inputsHash({
      ...ROOM,
      constants: { OG_NAME_MAX, ROOM_PREVIEW_LAST_TRAIN: !ROOM_PREVIEW_LAST_TRAIN },
      rendered: () =>
        ROOM_CASES.map(({ preview }) => {
          const card = roomShareCopy(preview, { lastTrain: !ROOM_PREVIEW_LAST_TRAIN }).card;
          return card ? renderToStaticMarkup(createElement(SharedCard, { data: card })) : "";
        }),
    });
    expect(flipped).not.toBe(inputsHash(ROOM));
    // 표본에는 막차가 실린 미리보기가 있다: 스위치에 따라 그린 마크업이 실제로 달라진다.
    const drawn = (lastTrain: boolean) =>
      ROOM_CASES.map(({ preview }) => {
        const card = roomShareCopy(preview, { lastTrain }).card;
        return card ? renderToStaticMarkup(createElement(SharedCard, { data: card })) : "";
      }).join("");
    expect(drawn(true)).toContain("막차");
    expect(drawn(false)).not.toMatch(/막차|늦어도/);
  });

  it("방 미리보기 그림 주소에 그 버전이 실린다(같은 방을 다시 공유해도 그림이 바뀌었으면 새 주소)", () => {
    expect(ROOM_OG_IMAGE_VERSION).toMatch(/^[0-9a-f]{8}$/);
    expect(roomImagePath("qt7yvmsht3", 4, "20261120.4")).toBe(
      `/r/qt7yvmsht3/og?sv=4&dv=20261120.4&iv=${ROOM_OG_IMAGE_VERSION}`,
    );
  });

  it("방 미리보기 그림이 그리는 문구 목록에 빠진 키가 없다(그림 코드와 그림 값을 만드는 코드가 OG_TEXT를 쓰는 만큼 적는다)", () => {
    for (const file of ["src/components/og/shared-card.tsx", "src/lib/room/share-copy.ts"]) {
      const code = readFileSync(join(ROOT, file), "utf8");
      const used = [...code.matchAll(/OG_TEXT\.(\w+)/g)].map((m) => m[1]);
      for (const key of used) expect(ROOM.texts, `${file}가 OG_TEXT.${key}를 쓴다`).toContain(key);
    }
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
