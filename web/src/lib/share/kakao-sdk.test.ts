// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KakaoFeedSettings } from "./kakao";
import type { KakaoSdk } from "./kakao-sdk";

const KEY = "a".repeat(32);
const LINK = {
  webUrl: "https://banbanyeok.app/r/qt7yvmsht3?sv=5",
  mobileWebUrl: "https://banbanyeok.app/r/qt7yvmsht3?sv=5",
};
const SETTINGS: KakaoFeedSettings = {
  objectType: "feed",
  content: {
    title: "지금은 강남이 제일 공평해요",
    description: "민수 22분",
    imageUrl: "https://banbanyeok.app/r/qt7yvmsht3/og?sv=5",
    imageWidth: 1200,
    imageHeight: 630,
    link: LINK,
  },
  buttons: [{ title: "내 출발역 넣기", link: LINK }],
};

type Loader = typeof import("./kakao-sdk");

/** SDK 상태는 페이지(모듈)마다 하나라 테스트마다 새로 불러온다. */
async function freshLoader(): Promise<Loader> {
  vi.resetModules();
  return import("./kakao-sdk");
}

const scripts = () => [...document.querySelectorAll<HTMLScriptElement>('script[src*="kakaocdn"]')];

function fakeSdk(): KakaoSdk & { init: ReturnType<typeof vi.fn>; API: { request: ReturnType<typeof vi.fn> } } {
  let key: string | null = null;
  return {
    init: vi.fn((k: string) => {
      key = k;
    }),
    isInitialized: () => key !== null,
    Share: { sendDefault: vi.fn() },
    API: { request: vi.fn(async () => ({})) },
  };
}

/** 브라우저가 스크립트를 받아 실행한 것처럼: SDK가 `window.Kakao`를 두고 load가 난다. */
function finishLoading(script: HTMLScriptElement | undefined, sdk: KakaoSdk) {
  window.Kakao = sdk;
  script?.dispatchEvent(new Event("load"));
}

beforeEach(() => {
  for (const script of scripts()) script.remove();
  delete window.Kakao;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("카카오 SDK 불러오기와 보내기 전 확인", () => {
  it("부르기 전에는 스크립트가 없고, 처음 부를 때 고정 버전을 SRI·익명 CORS·리퍼러 없이 하나만 넣는다", async () => {
    const loader = await freshLoader();
    expect(scripts()).toHaveLength(0);
    expect(loader.readyKakaoShare(SETTINGS)).toBeNull();

    loader.preloadKakaoShare(KEY, SETTINGS);
    loader.preloadKakaoShare(KEY, SETTINGS);
    void loader.prepareKakaoShare(KEY, SETTINGS, 1000);

    expect(scripts()).toHaveLength(1);
    const [script] = scripts();
    expect(script?.src).toBe("https://t1.kakaocdn.net/kakao_js_sdk/2.8.4/kakao.min.js");
    expect(script?.integrity).toBe("sha384-BGX7Wb16GmRFagri4bLJV2DgipVZaU2AI812GZtHtHzzDQJnfHasDXN5houxv45w");
    expect(script?.crossOrigin).toBe("anonymous");
    expect(script?.referrerPolicy).toBe("no-referrer");
  });

  it("받으면 앱 키로 한 번 초기화하고, 그 뒤로는 기다리지 않고 바로 쓴다", async () => {
    const loader = await freshLoader();
    const sdk = fakeSdk();
    const waiting = loader.prepareKakaoShare(KEY, SETTINGS, 1000);
    finishLoading(scripts()[0], sdk);

    await expect(waiting).resolves.toBe(sdk);
    expect(loader.readyKakaoShare(SETTINGS)).toBe(sdk);
    await expect(loader.prepareKakaoShare(KEY, SETTINGS, 1000)).resolves.toBe(sdk);
    expect(sdk.init).toHaveBeenCalledTimes(1);
    expect(sdk.init).toHaveBeenCalledWith(KEY);
    expect(scripts()).toHaveLength(1);
  });

  it("못 받으면(차단·네트워크·SRI 불일치) null이고 스크립트를 치워, 다음에 누를 때 다시 받는다", async () => {
    const loader = await freshLoader();
    const waiting = loader.prepareKakaoShare(KEY, SETTINGS, 1000);
    scripts()[0]?.dispatchEvent(new Event("error"));

    await expect(waiting).resolves.toBeNull();
    expect(loader.readyKakaoShare(SETTINGS)).toBeNull();
    expect(scripts()).toHaveLength(0);

    const sdk = fakeSdk();
    const retry = loader.prepareKakaoShare(KEY, SETTINGS, 1000);
    expect(scripts()).toHaveLength(1);
    finishLoading(scripts()[0], sdk);
    await expect(retry).resolves.toBe(sdk);
  });

  it("스크립트는 받았는데 SDK가 없거나 초기화가 실패하면 null", async () => {
    const loader = await freshLoader();
    const waiting = loader.prepareKakaoShare(KEY, SETTINGS, 1000);
    scripts()[0]?.dispatchEvent(new Event("load"));
    await expect(waiting).resolves.toBeNull();

    const broken = fakeSdk();
    broken.init.mockImplementation(() => {
      throw new Error("Kakao.init: Already initialized");
    });
    const again = loader.prepareKakaoShare(KEY, SETTINGS, 1000);
    finishLoading(scripts()[0], broken);
    await expect(again).resolves.toBeNull();
    expect(loader.readyKakaoShare(SETTINGS)).toBeNull();
  });

  it("한도 안에 못 받으면 null이고, 늦게라도 받으면 다음 누름부터 바로 쓴다", async () => {
    vi.useFakeTimers();
    const loader = await freshLoader();
    const waiting = loader.prepareKakaoShare(KEY, SETTINGS, 3000);
    await vi.advanceTimersByTimeAsync(3000);
    await expect(waiting).resolves.toBeNull();

    const sdk = fakeSdk();
    finishLoading(scripts()[0], sdk);
    await vi.waitFor(() => expect(loader.readyKakaoShare(SETTINGS)).toBe(sdk));
  });

  it("카카오가 메시지를 거절하면 null이고, 다음 누름에 다시 확인받는다", async () => {
    const loader = await freshLoader();
    const sdk = fakeSdk();
    sdk.API.request.mockRejectedValueOnce({ code: -401 });
    const first = loader.prepareKakaoShare(KEY, SETTINGS, 1000);
    finishLoading(scripts()[0], sdk);
    await expect(first).resolves.toBeNull();
    expect(loader.readyKakaoShare(SETTINGS)).toBeNull();

    await expect(loader.prepareKakaoShare(KEY, SETTINGS, 1000)).resolves.toBe(sdk);
    expect(loader.readyKakaoShare(SETTINGS)).toBe(sdk);
    expect(sdk.API.request).toHaveBeenCalledTimes(2);
  });

  it("받아 준 메시지는 다시 확인받지 않고, 내용이 바뀐 메시지는 새로 확인받는다", async () => {
    const loader = await freshLoader();
    const sdk = fakeSdk();
    const first = loader.prepareKakaoShare(KEY, SETTINGS, 1000);
    finishLoading(scripts()[0], sdk);
    await expect(first).resolves.toBe(sdk);
    await expect(loader.prepareKakaoShare(KEY, SETTINGS, 1000)).resolves.toBe(sdk);
    expect(sdk.API.request).toHaveBeenCalledTimes(1);

    const changed = { ...SETTINGS, content: { ...SETTINGS.content, description: "민수 22분 · 지연 19분" } };
    expect(loader.readyKakaoShare(changed)).toBeNull();
    await expect(loader.prepareKakaoShare(KEY, changed, 1000)).resolves.toBe(sdk);
    expect(sdk.API.request).toHaveBeenCalledTimes(2);
  });

  it("카카오가 답하지 않으면 한도에서 null", async () => {
    vi.useFakeTimers();
    const loader = await freshLoader();
    const sdk = fakeSdk();
    sdk.API.request.mockReturnValue(new Promise(() => {}));
    const waiting = loader.prepareKakaoShare(KEY, SETTINGS, 3000);
    finishLoading(scripts()[0], sdk);
    await vi.advanceTimersByTimeAsync(3000);
    await expect(waiting).resolves.toBeNull();
    expect(loader.readyKakaoShare(SETTINGS)).toBeNull();
  });
});
