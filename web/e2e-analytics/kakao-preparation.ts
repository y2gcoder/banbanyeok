import { expect, type Page } from "@playwright/test";
import { KAKAO_SDK } from "../src/lib/share/kakao";

type Preparation = {
  status: "unloaded" | "preparing" | "ready" | "failed";
  atClick: string[];
  responseReceived: boolean;
  release?: () => void;
};

declare global {
  interface Window {
    __kakaoPreparation: Preparation;
  }
}

/** 실제 SDK 구현을 유지하며 앱이 await하는 API Promise의 완료를 관측한다. */
export async function observePreparation(page: Page, holdResponse = false) {
  await page.addInitScript(
    ({ sdkUrl, holdResponse }) => {
      const observed: Preparation = { status: "unloaded", atClick: [], responseReceived: false };
      window.__kakaoPreparation = observed;
      document.addEventListener(
        "load",
        ({ target }) => {
          if (!(target instanceof HTMLScriptElement) || target.src !== sdkUrl) return;
          const sdk = window.Kakao;
          if (!sdk) throw new Error("Kakao SDK did not load");
          const init = sdk.init;
          // capture listener는 앱의 script.onload보다 먼저 호출된다. init 뒤 실제 API를 관측한다.
          sdk.init = (key) => {
            init.call(sdk, key);
            const request = sdk.API.request;
            sdk.API.request = (settings) => {
              observed.status = "preparing";
              const response = request.call(sdk.API, settings);
              const pending = holdResponse
                ? response.then(
                    (value) =>
                      new Promise((resolve) => {
                        observed.responseReceived = true;
                        observed.release = () => resolve(value);
                      }),
                  )
                : response;
              const settled = (status: "ready" | "failed") => {
                // Promise 완료 후 앱의 await/catch microtask가 끝난 다음 task에서 알린다.
                // 임의의 밀리초를 기다리지 않는다. 일반 검사에서는 SDK의 Promise와 반환값을 그대로 돌려준다.
                const channel = new MessageChannel();
                channel.port1.onmessage = () => {
                  observed.status = status;
                  channel.port1.close();
                  channel.port2.close();
                };
                channel.port2.postMessage(null);
              };
              void pending.then(
                () => settled("ready"),
                () => settled("failed"),
              );
              return pending;
            };
          };
        },
        true,
      );
      document.addEventListener(
        "click",
        ({ target }) => {
          if (target instanceof Element && target.closest("button")?.textContent?.includes("카톡으로")) {
            observed.atClick.push(observed.status);
          }
        },
        true,
      );
    },
    { sdkUrl: KAKAO_SDK.src, holdResponse },
  );
}

export async function waitForPreparation(page: Page, status: "ready" | "failed") {
  await expect.poll(() => page.evaluate(() => window.__kakaoPreparation.status), { timeout: 15_000 }).toBe(status);
}
