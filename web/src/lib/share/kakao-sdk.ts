/**
 * 카카오 SDK 미리 준비(브라우저 전용). 공유 칸이 화면에 들어오면 SDK를 받고, 이용자 내용이 없는 고정 메시지로 카카오에 앱 키·도메인·연결을
 * 확인받아 둔다. 그래야 버튼을 누른 그 클릭 안에서 `Share.sendDefault`를 부를 수 있다. 누른 뒤 SDK를 받거나 확인을 기다리면 iOS는 그
 * 이동을 이용자가 한 것으로 보지 않아 카카오톡 대신 카카오의 "카카오톡이 실행되지 않나요?" 페이지를 연다.
 *
 * 모바일의 `sendDefault`는 곧바로 돌아온 뒤 카카오에 그 메시지를 확인받고, 실패하면 이 페이지를 카카오 오류 페이지로 넘긴다. SDK 2.8.4에는
 * 이를 알리는 콜백·Promise가 없어서, 같은 확인을 SDK의 공개 API(`Kakao.API.request`)로 미리 받는다. 미리 받는 확인은 고정 메시지라
 * 앱 키·도메인 설정 오류와 카카오에 못 닿는 경우를 거르고, 실제 메시지는 누를 때만 카카오로 간다.
 *
 * 한 페이지에 SDK는 한 번만 받는다. 실패하면(SDK를 못 받음, 카카오가 거절) 다시 부를 때 다시 준비한다. 상태: 준비 전 → 준비 중 → 준비됨.
 */
import { SITE_OG_IMAGE_PATH } from "../copy/og-text";
import {
  KAKAO_SDK,
  type KakaoFeedMessage,
  type KakaoFeedSettings,
  kakaoFeedSettings,
  kakaoTemplateObject,
} from "./kakao";

/** 우리가 쓰는 SDK의 부분. */
export type KakaoSdk = {
  init(key: string): void;
  isInitialized(): boolean;
  Share: { sendDefault(settings: KakaoFeedSettings): void };
  API: { request(settings: { url: string; data: Record<string, unknown> }): Promise<unknown> };
};

declare global {
  interface Window {
    Kakao?: KakaoSdk;
  }
}

type State = { status: "idle" } | { status: "preparing" } | { status: "ready"; sdk: KakaoSdk };

let state: State = { status: "idle" };

function inject(key: string): Promise<KakaoSdk> {
  const script = document.createElement("script");
  script.src = KAKAO_SDK.src;
  script.integrity = KAKAO_SDK.integrity;
  script.crossOrigin = "anonymous";
  script.referrerPolicy = "no-referrer";
  script.async = true;
  const loaded = new Promise<KakaoSdk>((resolve, reject) => {
    script.onload = () => {
      const sdk = window.Kakao;
      if (!sdk) return reject(new Error("카카오 SDK가 없어요"));
      try {
        if (!sdk.isInitialized()) sdk.init(key);
        resolve(sdk);
      } catch (error) {
        reject(error);
      }
    };
    script.onerror = () => reject(new Error("카카오 SDK를 불러오지 못했어요"));
  });
  document.head.append(script);
  return loaded.catch((error: unknown) => {
    script.remove();
    throw error;
  });
}

/** 앞서 받아 초기화한 SDK가 있으면 그것을 쓴다(확인만 실패했을 때). */
function load(key: string): Promise<KakaoSdk> {
  const sdk = window.Kakao;
  return sdk?.isInitialized() ? Promise.resolve(sdk) : inject(key);
}

/** `sendDefault`가 모바일에서 보내는 것과 같은 확인 요청(SDK의 `API.request`가 받는 주소 목록에 있다). */
const TEMPLATE_CHECK = { url: "/v2/api/kakaolink/talk/template/default", linkVer: "4.0" } as const;

/** 미리 확인받는 메시지. 이용자·방의 내용(이름, 역, 시간, 방 ID, 공유 링크)은 넣지 않고 사이트 첫 화면과 기본 그림만 쓴다. */
const CHECK_MESSAGE: KakaoFeedMessage = {
  title: "반반역",
  description: "같이 만날 역 정해요",
  imagePath: SITE_OG_IMAGE_PATH,
  path: "/",
  buttons: [{ title: "반반역 열기", path: "/" }],
};

/** SDK를 받고 고정 메시지로 확인받아 둔다. 준비 중이거나 준비됐으면 아무것도 하지 않는다. */
export function preloadKakaoShare(key: string): void {
  if (state.status !== "idle") return;
  state = { status: "preparing" };
  const template = kakaoTemplateObject(kakaoFeedSettings(CHECK_MESSAGE, window.location.origin));
  load(key)
    .then(async (sdk) => {
      await sdk.API.request({
        url: TEMPLATE_CHECK.url,
        data: { link_ver: TEMPLATE_CHECK.linkVer, template_object: template },
      });
      state = { status: "ready", sdk };
    })
    .catch(() => {
      state = { status: "idle" };
    });
}

/** 준비된 SDK. 없으면 null(그 누름은 시스템 공유로 간다). */
export function readyKakaoShare(): KakaoSdk | null {
  return state.status === "ready" ? state.sdk : null;
}
