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
import { INVITE_COPY, type RoomShareCopy } from "@/lib/room/share-copy";
import { APP_NAME } from "./app-manifest";
import { OG_HEIGHT, OG_WIDTH } from "./og-text";
import { PAIR_PATH_PREFIX, type PairPage } from "./pair-pages";
import { absoluteUrl, isIndexableSite, siteEnv, siteUrl } from "./site";

type Env = Record<string, string | undefined>;

const SITE_NAME = "반반역";
const SITE_DESCRIPTION = "각자 지하철 시간으로 계산해서 공평하게 만날 역을 찾아요. 가입 없이 링크로 공유해요.";
export const HUB_PATH = PAIR_PATH_PREFIX;

type Social = {
  title: string;
  description: string;
  /** 사이트 안 경로(`/meet/…`). canonical과 og:url이 된다. */
  path: string;
  images?: NonNullable<Metadata["openGraph"]>["images"];
};

/** 색인해도 되는 사이트(SITE_URL이 localhost가 아님)가 아니면 noindex. */
function robots(env: Env): Metadata["robots"] {
  return isIndexableSite(env) ? undefined : { index: false, follow: false };
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
export function siteMetadata(env: Env = siteEnv()): Metadata {
  return {
    metadataBase: new URL(siteUrl(env)),
    applicationName: SITE_NAME,
    title: { default: SITE_NAME, template: `%s | ${SITE_NAME}` },
    description: SITE_DESCRIPTION,
    robots: robots(env),
    // 홈 화면에 추가한 iOS 웹 앱: 이름, 전체 화면 실행, 상태 표시줄은 기본(밝은 바탕·검은 글자, 내용은 그 아래에서 시작).
    // black-translucent는 내용이 상태 표시줄 밑으로 들어가고 글자가 흰색이라 밝은 화면에서 시계·배터리가 보이지 않는다.
    appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "default" },
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

/** 조합 페이지. */
export function pairMetadata(page: PairPage, env: Env = siteEnv()): Metadata {
  return {
    title: pairTitle(page),
    description: pairDescription(page),
    robots: robots(env),
    ...social({ title: pairTitle(page), description: pairDescription(page), path: page.path }, env),
  };
}

const HUB_TITLE = "인기 역 조합별 만날 곳 추천";
const HUB_DESCRIPTION =
  "강남·홍대입구·잠실처럼 자주 만나는 두 역을 골라, 각자 지하철 시간으로 계산한 공평한 만날 곳 3곳을 비교해 보세요.";

export function hubMetadata(env: Env = siteEnv()): Metadata {
  return {
    title: HUB_TITLE,
    description: HUB_DESCRIPTION,
    robots: robots(env),
    ...social({ title: HUB_TITLE, description: HUB_DESCRIPTION, path: HUB_PATH }, env),
  };
}

/** 사이트 기본 미리보기 이미지(빌드 때 만든 정적 PNG). `openGraph`를 하위 페이지가 정의하면 부모의 이미지가 사라지므로 직접 가리킨다. */
const DEFAULT_IMAGES = [
  { url: "/opengraph-image", width: OG_WIDTH, height: OG_HEIGHT, alt: `${SITE_NAME}: 우리 어디서 만나야 덜 억울할까?` },
];

/**
 * 링크마다 다른, 색인하지 않는 페이지(`/s`, `/result`, `/r/[방 ID]`)의 공통 부분. 레이아웃의 canonical·og:url(홈)을 물려받지 않게
 * canonical을 지우고 og:url을 두지 않는다(메신저는 공유한 링크 그대로 연다).
 */
function linkPageMetadata(title: string, description: string, images: NonNullable<Metadata["openGraph"]>["images"]) {
  const fullTitle = `${title} | ${SITE_NAME}`;
  return {
    robots: { index: false, follow: false },
    alternates: { canonical: null },
    title,
    description,
    openGraph: { type: "website", siteName: SITE_NAME, locale: "ko_KR", title: fullTitle, description, images },
    twitter: { card: "summary_large_image", title: fullTitle, description, images },
  } satisfies Metadata;
}

const LINK_FALLBACK_TITLE = "만날 역 후보";

/**
 * 공유 링크(`/s`): 색인하지 않는다(개인이 만든 링크). 미리보기 제목·설명·이미지만 링크별로 다르다.
 * 결과를 못 가져왔으면(잘못된 링크·서버 지연) 기본 제목·설명과 사이트 기본 이미지. `/result`도 이 기본값을 쓴다.
 */
export function sharedLinkMetadata(
  preview: { title: string; description: string; imagePath: string } | null,
): Metadata {
  if (!preview) return linkPageMetadata(LINK_FALLBACK_TITLE, SITE_DESCRIPTION, DEFAULT_IMAGES);
  const images = [{ url: preview.imagePath, width: OG_WIDTH, height: OG_HEIGHT, alt: preview.title }];
  return linkPageMetadata(preview.title, preview.description, images);
}

const { title: ROOM_TITLE, description: ROOM_DESCRIPTION } = INVITE_COPY.preview;

/**
 * 공유 번호가 없는 방 링크(`/r/<방 ID>`), 방 만들기(`/r/new`), 방 미리보기를 못 받은 경우의 미리보기. **방 ID·참여자 정보를 쓰지 않는
 * 일반 문구**다: 서버를 부르지 않고(방 ID만으로는 어떤 방인지 알 수 없게), 요청마다 이미지를 그리지 않는다(Workers CPU). 색인하지 않는다.
 */
export function roomLinkMetadata(): Metadata {
  return linkPageMetadata(ROOM_TITLE, ROOM_DESCRIPTION, DEFAULT_IMAGES);
}

/**
 * 공유 번호가 붙은 방 링크(`/r/<방 ID>?sv=`)의 미리보기: 방의 지금 단계 문구(`roomShareCopy`)와 그 방 그림. 그림이 없는 단계(모으는 중)는
 * 사이트 기본 이미지. 색인하지 않는다.
 */
export function roomPreviewMetadata(copy: RoomShareCopy, imagePath: string | null): Metadata {
  const { title, description } = copy.preview;
  const images = imagePath ? [{ url: imagePath, width: OG_WIDTH, height: OG_HEIGHT, alt: title }] : DEFAULT_IMAGES;
  return linkPageMetadata(title, description, images);
}

/** 방 만들기(`/r/new`): 방 링크와 같은 문구·이미지이고 색인하지 않지만, 링크마다 다르지 않아 canonical·og:url은 자기 주소다. */
export function newRoomMetadata(env: Env = siteEnv()): Metadata {
  return {
    ...plainPageMetadata({ title: ROOM_TITLE, description: ROOM_DESCRIPTION, path: "/r/new" }, env),
    robots: { index: false, follow: false },
  };
}

/**
 * 링크마다 다르지 않은 일반 페이지(`/privacy`, `/r/new`): canonical·og:url을 자기 주소로(레이아웃의 홈 주소를 물려받지 않게).
 * 이미지는 사이트 기본 미리보기.
 */
export function plainPageMetadata(
  { title, description, path }: { title: string; description: string; path: string },
  env: Env = siteEnv(),
): Metadata {
  return {
    title,
    description,
    robots: robots(env),
    ...social({ title, description, path, images: DEFAULT_IMAGES }, env),
  };
}
