/**
 * 카카오 SDK 불러오기(브라우저 전용). SDK 스크립트를 받는 순간 방문자의 IP·브라우저 정보가 카카오로 가므로 페이지를 열 때는 부르지 않고,
 * 카카오톡 공유 버튼을 누르기 시작할 때(포인터를 누르거나 Enter·Space) 처음 받는다. 한 페이지에서 한 번만 받고, 실패하면 다음에 누를 때
 * 다시 받는다. 상태: 받기 전 → 받는 중 → 준비됨(실패하면 받기 전으로).
 */
import { KAKAO_SDK, type KakaoFeedSettings } from "./kakao";

/** 우리가 쓰는 SDK의 부분. */
export type KakaoSdk = {
  init(key: string): void;
  isInitialized(): boolean;
  Share: { sendDefault(settings: KakaoFeedSettings): void };
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

/** 누르기 시작할 때 미리 받는다. 실패는 누른 뒤(`waitForKakaoSdk`)에 다룬다. */
export function preloadKakaoSdk(key: string): void {
  load(key).catch(() => {});
}

/** 지금 바로 쓸 수 있는 SDK. 버튼을 누른 그 순간에 부르면 PC의 공유 창이 팝업 차단에 걸리지 않는다. */
export function readyKakaoSdk(): KakaoSdk | null {
  return state.status === "ready" ? state.sdk : null;
}

/** 받는 중이면 `timeoutMs`까지 기다린다. 못 받거나 늦으면 null(부른 쪽은 시스템 공유로 간다). */
export function waitForKakaoSdk(key: string, timeoutMs: number): Promise<KakaoSdk | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  return Promise.race([load(key).catch(() => null), late]).finally(() => clearTimeout(timer));
}
