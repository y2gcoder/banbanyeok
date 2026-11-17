/**
 * 카카오 SDK 불러오기와 보내기 전 확인(브라우저 전용). SDK 스크립트를 받는 순간 방문자의 IP·브라우저 정보가 카카오로 가므로 페이지를 열 때는
 * 부르지 않고, 카카오톡 공유 버튼을 누르기 시작할 때(포인터를 누르거나 Enter·Space) 처음 받는다. 한 페이지에서 한 번만 받고, 실패하면 다음에
 * 누를 때 다시 받는다. 상태: 받기 전 → 받는 중 → 준비됨(실패하면 받기 전으로).
 *
 * 모바일의 `Share.sendDefault`는 곧바로 돌아온 뒤 카카오에 템플릿을 확인받고, 실패하면(앱 키·도메인 설정 오류, 카카오에 못 닿음) 이 페이지를
 * 카카오 오류 페이지로 넘긴다. SDK 2.8.4에는 이를 알리는 콜백·Promise·설정이 없어서, 보내기 전에 같은 확인을 SDK의 공개 API
 * (`Kakao.API.request`)로 먼저 받고 통과한 메시지만 보낸다.
 */
import { KAKAO_SDK, type KakaoFeedSettings, kakaoTemplateObject } from "./kakao";

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

type State =
  | { status: "idle" }
  | { status: "loading"; promise: Promise<KakaoSdk> }
  | { status: "ready"; sdk: KakaoSdk };

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
  return loaded.then(
    (sdk) => {
      state = { status: "ready", sdk };
      return sdk;
    },
    (error: unknown) => {
      script.remove();
      state = { status: "idle" };
      throw error;
    },
  );
}

function load(key: string): Promise<KakaoSdk> {
  if (state.status === "ready") return Promise.resolve(state.sdk);
  if (state.status === "loading") return state.promise;
  const promise = inject(key);
  state = { status: "loading", promise };
  return promise;
}

/** `sendDefault`가 모바일에서 보내는 것과 같은 확인 요청(SDK의 `API.request`가 받는 주소 목록에 있다). */
const TEMPLATE_CHECK = { url: "/v2/api/kakaolink/talk/template/default", linkVer: "4.0" } as const;

// 카카오가 받아 준 메시지(템플릿 JSON). 이 페이지에서는 다시 확인하지 않아, 두 번째 누름부터 클릭 안에서 바로 보낼 수 있다.
const accepted = new Set<string>();
const checking = new Map<string, Promise<boolean>>();

const templateKey = (settings: KakaoFeedSettings) => JSON.stringify(kakaoTemplateObject(settings));

function check(sdk: KakaoSdk, settings: KakaoFeedSettings): Promise<boolean> {
  const key = templateKey(settings);
  if (accepted.has(key)) return Promise.resolve(true);
  let pending = checking.get(key);
  if (!pending) {
    pending = Promise.resolve()
      .then(() =>
        sdk.API.request({
          url: TEMPLATE_CHECK.url,
          data: { link_ver: TEMPLATE_CHECK.linkVer, template_object: kakaoTemplateObject(settings) },
        }),
      )
      .then(
        () => {
          accepted.add(key);
          return true;
        },
        () => false,
      )
      .finally(() => checking.delete(key));
    checking.set(key, pending);
  }
  return pending;
}

function prepare(key: string, settings: KakaoFeedSettings): Promise<KakaoSdk | null> {
  return load(key).then(
    async (sdk) => ((await check(sdk, settings)) ? sdk : null),
    () => null,
  );
}

/** 누르기 시작할 때 SDK를 받고 메시지를 확인받아 둔다. 실패는 누른 뒤(`prepareKakaoShare`)에 다룬다. */
export function preloadKakaoShare(key: string, settings: KakaoFeedSettings): void {
  void prepare(key, settings);
}

/**
 * SDK가 준비됐고 카카오가 이 메시지를 이미 받아 줬으면 그 SDK. 버튼을 누른 그 순간에 보내면 PC의 공유 창이 팝업 차단에 걸리지 않는다.
 */
export function readyKakaoShare(settings: KakaoFeedSettings): KakaoSdk | null {
  return state.status === "ready" && accepted.has(templateKey(settings)) ? state.sdk : null;
}

/** SDK를 받고 메시지를 확인받기를 `timeoutMs`까지 기다린다. 못 받거나, 카카오가 거절하거나, 늦으면 null(부른 쪽은 시스템 공유로 간다). */
export function prepareKakaoShare(
  key: string,
  settings: KakaoFeedSettings,
  timeoutMs: number,
): Promise<KakaoSdk | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  return Promise.race([prepare(key, settings), late]).finally(() => clearTimeout(timer));
}
