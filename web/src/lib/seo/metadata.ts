/**
 * 페이지별 메타데이터(title·description·canonical·Open Graph·Twitter)를 만드는 순수 함수.
 * 페이지 파일은 이 함수를 부르기만 한다. 값 규칙(길이·문구·canonical)은 `metadata.test.ts`로 고정한다.
 *
 * Next의 메타데이터는 최상위 키 단위로 덮어쓴다(`openGraph`를 하위 페이지가 정의하면 부모 것은 통째로 사라진다).
 * 그래서 하위 페이지도 `openGraph`·`twitter`를 빠짐없이 채운다.
 */
import type { Metadata } from "next";
import { withJosa } from "@/lib/display/korean";
import { formatMinutes } from "@/lib/display/minutes";
import { OG_HEIGHT, OG_WIDTH } from "./og-text";
import { PAIR_PATH_PREFIX, type PairPage } from "./pair-pages";
import { absoluteUrl, isIndexableSite, siteUrl } from "./site";

type Env = Record<string, string | undefined>;

const SITE_NAME = "반반역";
const SITE_DESCRIPTION = "각자 지하철 시간으로 계산해서 공평하게 만날 역을 찾아요. 가입 없이 링크로 공유해요.";
export const HUB_PATH = PAIR_PATH_PREFIX;

type Social = {
  title: string;
  description: string;
  /** 사이트 안 경로(`/meet/…`). canonical과 og:url이 된다. */
  path: string;
  images?: string[];
};

function noindex(env: Env, index: boolean): Metadata["robots"] {
  return index && isIndexableSite(env) ? undefined : { index: false, follow: false };
}

function social(
  { title, description, path, images }: Social,
  env: Env,
): Pick<Metadata, "alternates" | "openGraph" | "twitter"> {
  const url = absoluteUrl(path, env);
  const fullTitle = `${title} | ${SITE_NAME}`;
  return {
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "ko_KR",
      url,
      title: fullTitle,
      description,
      ...(images ? { images } : {}),
    },
    twitter: { card: "summary_large_image", title: fullTitle, description, ...(images ? { images } : {}) },
  };
}

/** 루트 레이아웃의 기본 메타. `metadataBase`가 있어야 상대 경로(OG 이미지 등)가 절대 주소가 된다. */
export function siteMetadata(env: Env = process.env): Metadata {
  return {
    metadataBase: new URL(siteUrl(env)),
    applicationName: SITE_NAME,
    title: { default: SITE_NAME, template: `%s | ${SITE_NAME}` },
    description: SITE_DESCRIPTION,
    robots: noindex(env, true),
    ...social({ title: "우리 어디서 만나야 덜 억울할까?", description: SITE_DESCRIPTION, path: "/" }, env),
  };
}

/** 이 조합 페이지의 제목: "강남역·홍대입구역 중간 만날 곳 추천 3곳". */
export function pairTitle(page: PairPage): string {
  return `${page.first.label}·${page.second.label} 중간 만날 곳 추천 ${page.candidates.length}곳`;
}

/** 설명: 1위와 각자 시간을 앞에 두고 무엇을 비교하는지 밝힌다(제안하는 말투, 과장 없음). */
export function pairDescription(page: PairPage): string {
  const top = page.candidates[0];
  if (!top) return SITE_DESCRIPTION;
  const [a, b] = top.people;
  return (
    `${withJosa(page.first.name, "과/와")} ${page.second.name}에서 출발하면 ${withJosa(top.station.name, "은/는")} 가장 공평해요. ` +
    `${a.stationName} ${formatMinutes(a.minutes)}, ${b.stationName} ${formatMinutes(b.minutes)}. ` +
    `후보 ${page.candidates.length}곳의 시간·환승·이유를 비교해 보세요.`
  );
}

/** 조합 페이지. `indexable`은 데이터가 실제 산출물일 때만 true(개발용 표본은 색인하지 않는다). */
export function pairMetadata(page: PairPage, indexable: boolean, env: Env = process.env): Metadata {
  return {
    title: pairTitle(page),
    description: pairDescription(page),
    robots: noindex(env, indexable),
    ...social({ title: pairTitle(page), description: pairDescription(page), path: page.path }, env),
  };
}

const HUB_TITLE = "인기 역 조합별 만날 곳 추천";
const HUB_DESCRIPTION =
  "강남·홍대입구·잠실처럼 자주 만나는 두 역을 골라, 각자 지하철 시간으로 계산한 공평한 만날 곳 3곳을 비교해 보세요.";

export function hubMetadata(indexable: boolean, env: Env = process.env): Metadata {
  return {
    title: HUB_TITLE,
    description: HUB_DESCRIPTION,
    robots: noindex(env, indexable),
    ...social({ title: HUB_TITLE, description: HUB_DESCRIPTION, path: HUB_PATH }, env),
  };
}

/** 공유 링크(`/s`): 색인하지 않는다(개인이 만든 링크). 미리보기 제목·설명·이미지만 링크별로 다르다. */
export function sharedLinkMetadata(
  preview: { title: string; description: string; imagePath: string } | null,
): Metadata {
  const base = { robots: { index: false, follow: false } } satisfies Metadata;
  if (!preview) return { ...base, title: "만날 역 후보" };
  const fullTitle = `${preview.title} | ${SITE_NAME}`;
  const images = [{ url: preview.imagePath, width: OG_WIDTH, height: OG_HEIGHT, alt: preview.title }];
  return {
    ...base,
    title: preview.title,
    description: preview.description,
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "ko_KR",
      title: fullTitle,
      description: preview.description,
      images,
    },
    twitter: { card: "summary_large_image", title: fullTitle, description: preview.description, images },
  };
}
