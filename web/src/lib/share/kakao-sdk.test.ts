// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SITE_OG_IMAGE_PATH } from "@/lib/copy/og-text";
import type { KakaoSdk } from "./kakao-sdk";

const KEY = "a".repeat(32);

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

describe("카카오 SDK 미리 준비", () => {
  it("부르기 전에는 스크립트가 없고, 처음 부를 때 고정 버전을 SRI·익명 CORS·리퍼러 없이 하나만 넣는다", async () => {
    const loader = await freshLoader();
    expect(scripts()).toHaveLength(0);
    expect(loader.readyKakaoShare()).toBeNull();

    loader.preloadKakaoShare(KEY);
    loader.preloadKakaoShare(KEY);

    expect(scripts()).toHaveLength(1);
    const [script] = scripts();
    expect(script?.src).toBe("https://t1.kakaocdn.net/kakao_js_sdk/2.8.4/kakao.min.js");
    expect(script?.integrity).toBe("sha384-BGX7Wb16GmRFagri4bLJV2DgipVZaU2AI812GZtHtHzzDQJnfHasDXN5houxv45w");
    expect(script?.crossOrigin).toBe("anonymous");
    expect(script?.referrerPolicy).toBe("no-referrer");
    expect(loader.readyKakaoShare()).toBeNull();
  });

  it("받으면 앱 키로 한 번 초기화하고, 이용자 내용이 없는 고정 메시지로 한 번 확인받은 뒤 준비된다", async () => {
    const loader = await freshLoader();
    const sdk = fakeSdk();
    loader.preloadKakaoShare(KEY);
    finishLoading(scripts()[0], sdk);

    await vi.waitFor(() => expect(loader.readyKakaoShare()).toBe(sdk));
    loader.preloadKakaoShare(KEY);
    expect(sdk.init).toHaveBeenCalledTimes(1);
    expect(sdk.init).toHaveBeenCalledWith(KEY);
    expect(scripts()).toHaveLength(1);
    const origin = window.location.origin;
    const site = { web_url: `${origin}/`, mobile_web_url: `${origin}/` };
    expect(sdk.API.request).toHaveBeenCalledTimes(1);
    expect(sdk.API.request).toHaveBeenCalledWith({
      url: "/v2/api/kakaolink/talk/template/default",
      data: {
        link_ver: "4.0",
        template_object: {
          object_type: "feed",
          content: {
            title: "반반역",
            description: "같이 만날 역 정해요",
            image_url: `${origin}${SITE_OG_IMAGE_PATH}`,
            image_width: 1200,
            image_height: 630,
            link: site,
          },
          buttons: [{ title: "반반역 열기", link: site }],
        },
      },
    });
  });

  it("못 받으면(차단·네트워크·SRI 불일치) 준비되지 않고 스크립트를 치워, 다시 부르면 다시 받는다", async () => {
    const loader = await freshLoader();
    loader.preloadKakaoShare(KEY);
    scripts()[0]?.dispatchEvent(new Event("error"));
    await vi.waitFor(() => expect(scripts()).toHaveLength(0));
    expect(loader.readyKakaoShare()).toBeNull();

    const sdk = fakeSdk();
    loader.preloadKakaoShare(KEY);
    expect(scripts()).toHaveLength(1);
    finishLoading(scripts()[0], sdk);
    await vi.waitFor(() => expect(loader.readyKakaoShare()).toBe(sdk));
  });

  it("스크립트는 받았는데 SDK가 없거나 초기화가 실패하면 준비되지 않는다", async () => {
    const loader = await freshLoader();
    loader.preloadKakaoShare(KEY);
    scripts()[0]?.dispatchEvent(new Event("load"));
    await vi.waitFor(() => expect(scripts()).toHaveLength(0));

    const broken = fakeSdk();
    broken.init.mockImplementation(() => {
      throw new Error("Kakao.init: Already initialized");
    });
    loader.preloadKakaoShare(KEY);
    finishLoading(scripts()[0], broken);
    await vi.waitFor(() => expect(scripts()).toHaveLength(0));
    expect(loader.readyKakaoShare()).toBeNull();
    expect(broken.API.request).not.toHaveBeenCalled();
  });

  it("카카오가 확인을 거절하면 준비되지 않고, 다시 부르면 SDK는 그대로 두고 확인만 다시 받는다", async () => {
    const loader = await freshLoader();
    const sdk = fakeSdk();
    sdk.API.request.mockRejectedValueOnce({ code: -401 });
    loader.preloadKakaoShare(KEY);
    finishLoading(scripts()[0], sdk);
    await vi.waitFor(() => expect(sdk.API.request).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loader.readyKakaoShare()).toBeNull();

    loader.preloadKakaoShare(KEY);
    await vi.waitFor(() => expect(loader.readyKakaoShare()).toBe(sdk));
    expect(sdk.API.request).toHaveBeenCalledTimes(2);
    expect(scripts()).toHaveLength(1);
    expect(sdk.init).toHaveBeenCalledTimes(1);
  });

  it("카카오가 답하지 않는 동안은 준비되지 않고, 다시 불러도 확인을 겹쳐 보내지 않는다", async () => {
    const loader = await freshLoader();
    const sdk = fakeSdk();
    sdk.API.request.mockReturnValue(new Promise(() => {}));
    loader.preloadKakaoShare(KEY);
    finishLoading(scripts()[0], sdk);
    await vi.waitFor(() => expect(sdk.API.request).toHaveBeenCalledTimes(1));
    loader.preloadKakaoShare(KEY);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sdk.API.request).toHaveBeenCalledTimes(1);
    expect(loader.readyKakaoShare()).toBeNull();
  });
});
