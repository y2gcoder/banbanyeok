/**
 * 카카오톡 공유 API(`Kakao.Share.sendDefault`, 피드 템플릿)로 보내는 메시지. 링크 미리보기는 카카오가 주소마다 한 번 읽어 오래 캐시하지만,
 * 이 메시지는 보낼 때 정한 제목·설명·그림·버튼이 그대로 간다(#51 B단계). 공유 시트·링크 복사와 같은 문구에서 만든다.
 *
 * 앱 키(JavaScript 키)는 공개 값이다(카카오가 등록된 도메인에서 온 요청만 받는다). 빌드 때 `NEXT_PUBLIC_KAKAO_JS_KEY`로 박히고, 없거나
 * 형식이 틀리면 카카오 공유는 완전히 꺼진다(SDK를 불러오지 않고 CSP에도 카카오 주소를 넣지 않는다).
 */
// next.config.ts가 CSP를 만들려고 이 파일을 불러오므로 `@/` 별칭 없이 적는다.
import { OG_HEIGHT, OG_WIDTH } from "../seo/og-text";

/** 사이트 안 경로. 보낼 때 이 페이지의 출처를 붙인다(카카오는 앱에 등록한 도메인의 링크만 받는다). */
type KakaoButton = { title: string; path: string };

export type KakaoFeedMessage = {
  title: string;
  description: string;
  imagePath: string;
  /** 그림·제목을 누르면 여는 곳. */
  path: string;
  /** 카카오는 버튼을 두 개까지 받는다. */
  buttons: readonly [KakaoButton] | readonly [KakaoButton, KakaoButton];
};

type KakaoLink = { webUrl: string; mobileWebUrl: string };

/** `Kakao.Share.sendDefault`의 인자(피드). */
export type KakaoFeedSettings = {
  objectType: "feed";
  content: {
    title: string;
    description: string;
    imageUrl: string;
    imageWidth: number;
    imageHeight: number;
    link: KakaoLink;
  };
  buttons: { title: string; link: KakaoLink }[];
};

/** 카카오 공식 CDN의 SDK. 버전은 게시 후 7일이 지난 안정판으로 고정하고, 공식 문서의 SRI 해시를 함께 건다. */
export const KAKAO_SDK = {
  src: "https://t1.kakaocdn.net/kakao_js_sdk/2.8.4/kakao.min.js",
  integrity: "sha384-BGX7Wb16GmRFagri4bLJV2DgipVZaU2AI812GZtHtHzzDQJnfHasDXN5houxv45w",
} as const;

/** SDK가 공유할 때 쓰는 카카오 주소. 모바일은 템플릿 검사 요청(XHR), PC는 공유 창에 폼 전송, 일부 안드로이드 브라우저는 숨은 프레임. */
export const KAKAO_SHARE_CSP = {
  connect: "https://kapi.kakao.com",
  formAction: "https://sharer.kakao.com",
  frame: "kakaolink:",
} as const;

const JS_KEY = /^[0-9a-f]{32}$/i;

export function kakaoJsKey(raw: string | undefined): string | null {
  const key = raw?.trim();
  return key && JS_KEY.test(key) ? key : null;
}

/** 번들러가 리터럴 `process.env.NEXT_PUBLIC_*`만 바꿔 넣으므로 이름을 그대로 적는다. */
export function publicKakaoJsKey(): string | null {
  return kakaoJsKey(process.env.NEXT_PUBLIC_KAKAO_JS_KEY);
}

/**
 * `sendDefault` 인자를 카카오 기본 템플릿 JSON(`template_object`)으로. SDK가 모바일에서 카카오톡을 열기 전에 카카오에 확인받는 내용과 같은
 * 모양이다(미리 받는 확인이 쓴다. e2e가 둘의 모양이 같은지 본다).
 */
export function kakaoTemplateObject(settings: KakaoFeedSettings) {
  const link = ({ webUrl, mobileWebUrl }: KakaoLink) => ({ web_url: webUrl, mobile_web_url: mobileWebUrl });
  const { content } = settings;
  return {
    object_type: settings.objectType,
    content: {
      title: content.title,
      description: content.description,
      image_url: content.imageUrl,
      image_width: content.imageWidth,
      image_height: content.imageHeight,
      link: link(content.link),
    },
    buttons: settings.buttons.map((button) => ({ title: button.title, link: link(button.link) })),
  };
}

export function kakaoFeedSettings(message: KakaoFeedMessage, origin: string): KakaoFeedSettings {
  const link = (path: string): KakaoLink => {
    const url = new URL(path, origin).toString();
    return { webUrl: url, mobileWebUrl: url };
  };
  return {
    objectType: "feed",
    content: {
      title: message.title,
      description: message.description,
      imageUrl: new URL(message.imagePath, origin).toString(),
      imageWidth: OG_WIDTH,
      imageHeight: OG_HEIGHT,
      link: link(message.path),
    },
    buttons: message.buttons.map((button) => ({ title: button.title, link: link(button.path) })),
  };
}
