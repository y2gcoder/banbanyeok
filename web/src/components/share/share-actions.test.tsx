// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KakaoFeedMessage, KakaoFeedSettings } from "@/lib/share/kakao";
import type { KakaoSdk } from "@/lib/share/kakao-sdk";

vi.mock("@/lib/analytics", async (importOriginal) => ({ ...(await importOriginal<object>()), track: vi.fn() }));

const KEY = "a".repeat(32);
const MESSAGE: KakaoFeedMessage = {
  title: "지금은 강남이 제일 공평해요",
  description: "아직이면 출발역 넣어 주세요 · 민수 22분",
  imagePath: "/r/qt7yvmsht3/og?sv=5&dv=20261115.8",
  path: "/r/qt7yvmsht3?sv=5",
  buttons: [{ title: "내 출발역 넣기", path: "/r/qt7yvmsht3?sv=5" }],
};

const scripts = () => document.querySelectorAll('script[src*="kakaocdn"]');
const kakaoButton = () => screen.getByRole("button", { name: /카톡으로 결과 보내기/ });

/** `accepts`가 거짓이면 카카오가 메시지를 거절한다(앱 키·도메인 설정 오류, 카카오에 못 닿음 등). */
function fakeSdk({ accepts = true } = {}) {
  let ready = false;
  const sendDefault = vi.fn<(settings: KakaoFeedSettings) => void>();
  const request = vi.fn(async (_settings: { url: string; data: Record<string, unknown> }) => {
    if (!accepts) throw { code: -401, msg: "appKey does not exist" };
    return {};
  });
  const sdk = {
    init: () => {
      ready = true;
    },
    isInitialized: () => ready,
    Share: { sendDefault },
    API: { request },
  } satisfies KakaoSdk;
  return sdk;
}

/** 누르기 시작할 때 받은 SDK가 카카오에 메시지를 확인받을 때까지. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function finishLoading(sdk: KakaoSdk) {
  window.Kakao = sdk;
  scripts()[0]?.dispatchEvent(new Event("load"));
}

/** SDK 상태는 페이지마다 하나라 테스트마다 모듈을 새로 불러온다. */
async function renderShare() {
  vi.resetModules();
  const { ShareActions } = await import("./share-actions");
  const { track } = await import("@/lib/analytics");
  render(
    <ShareActions
      path="/r/qt7yvmsht3?sv=5"
      title="지금은 강남이 제일 공평해요"
      text="아직이면 출발역 넣어 주세요 · 민수 22분"
      button="카톡으로 결과 보내기"
      linkType="room"
      room={{ roomId: "qt7yvmsht3", roomHash: "0123456789abcdef", stage: "result" }}
      kakao={MESSAGE}
    />,
  );
  return vi.mocked(track);
}

const share = vi.fn(async () => {});

beforeEach(() => {
  for (const script of scripts()) script.remove();
  delete window.Kakao;
  share.mockClear();
  Object.defineProperty(navigator, "share", { value: share, configurable: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const ROOM = { link_type: "room", room_hash: "0123456789abcdef", room_stage: "result" };

describe("카톡으로 보내기", () => {
  it("빌드에 카카오 앱 키가 없으면 카카오 SDK를 받지 않고 지금처럼 공유 시트를 연다", async () => {
    vi.stubEnv("NEXT_PUBLIC_KAKAO_JS_KEY", "");
    const track = await renderShare();
    fireEvent.pointerDown(kakaoButton());
    fireEvent.click(kakaoButton());

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(share).toHaveBeenCalledWith({
      title: "지금은 강남이 제일 공평해요",
      text: "아직이면 출발역 넣어 주세요 · 민수 22분",
      url: `${window.location.origin}/r/qt7yvmsht3?sv=5`,
    });
    expect(track).toHaveBeenCalledWith("share_clicked", { channel: "system", ...ROOM });
    expect(scripts()).toHaveLength(0);
  });

  it("키가 있으면 화면을 열 때는 받지 않고, 누르기 시작할 때 받아 두었다가 누르면 카카오톡 공유 API로 보낸다", async () => {
    vi.stubEnv("NEXT_PUBLIC_KAKAO_JS_KEY", KEY);
    const track = await renderShare();
    expect(scripts()).toHaveLength(0);

    fireEvent.pointerDown(kakaoButton());
    expect(scripts()).toHaveLength(1);
    const sdk = fakeSdk();
    finishLoading(sdk);
    await waitFor(() => expect(sdk.API.request).toHaveBeenCalledTimes(1));
    await settle();

    fireEvent.click(kakaoButton());
    const origin = window.location.origin;
    const link = { webUrl: `${origin}/r/qt7yvmsht3?sv=5`, mobileWebUrl: `${origin}/r/qt7yvmsht3?sv=5` };
    expect(sdk.Share.sendDefault).toHaveBeenCalledTimes(1);
    expect(sdk.Share.sendDefault).toHaveBeenCalledWith({
      objectType: "feed",
      content: {
        title: "지금은 강남이 제일 공평해요",
        description: "아직이면 출발역 넣어 주세요 · 민수 22분",
        imageUrl: `${origin}/r/qt7yvmsht3/og?sv=5&dv=20261115.8`,
        imageWidth: 1200,
        imageHeight: 630,
        link,
      },
      buttons: [{ title: "내 출발역 넣기", link }],
    });
    expect(track).toHaveBeenCalledWith("share_clicked", { channel: "kakao", ...ROOM });
    expect(share).not.toHaveBeenCalled();
    expect(sdk.API.request).toHaveBeenCalledWith({
      url: "/v2/api/kakaolink/talk/template/default",
      data: {
        link_ver: "4.0",
        template_object: {
          object_type: "feed",
          content: {
            title: "지금은 강남이 제일 공평해요",
            description: "아직이면 출발역 넣어 주세요 · 민수 22분",
            image_url: `${origin}/r/qt7yvmsht3/og?sv=5&dv=20261115.8`,
            image_width: 1200,
            image_height: 630,
            link: { web_url: link.webUrl, mobile_web_url: link.mobileWebUrl },
          },
          buttons: [{ title: "내 출발역 넣기", link: { web_url: link.webUrl, mobile_web_url: link.mobileWebUrl } }],
        },
      },
    });
  });

  it("카카오가 메시지를 받지 않으면(앱 키·도메인 설정 오류, 카카오에 못 닿음) SDK로 보내지 않고 공유 시트로 간다", async () => {
    vi.stubEnv("NEXT_PUBLIC_KAKAO_JS_KEY", KEY);
    const track = await renderShare();
    fireEvent.pointerDown(kakaoButton());
    fireEvent.click(kakaoButton());
    const sdk = fakeSdk({ accepts: false });
    finishLoading(sdk);

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(sdk.Share.sendDefault).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("share_clicked", { channel: "system", ...ROOM });
  });

  it("첫 누름에 SDK가 아직 오는 중이면 받을 때까지 기다렸다 카카오로 보낸다(Enter로 눌러도 같다)", async () => {
    vi.stubEnv("NEXT_PUBLIC_KAKAO_JS_KEY", KEY);
    const track = await renderShare();
    fireEvent.keyDown(kakaoButton(), { key: "Enter" });
    expect(scripts()).toHaveLength(1);
    fireEvent.click(kakaoButton());
    fireEvent.click(kakaoButton());

    const sdk = fakeSdk();
    finishLoading(sdk);
    await waitFor(() => expect(sdk.Share.sendDefault).toHaveBeenCalledTimes(1));
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("share_clicked", { channel: "kakao", ...ROOM });
    expect(share).not.toHaveBeenCalled();
  });

  it("SDK를 못 받거나 SDK가 거절하면 그 누름은 공유 시트로 간다", async () => {
    vi.stubEnv("NEXT_PUBLIC_KAKAO_JS_KEY", KEY);
    const track = await renderShare();
    fireEvent.click(kakaoButton());
    scripts()[0]?.dispatchEvent(new Event("error"));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(track).toHaveBeenLastCalledWith("share_clicked", { channel: "system", ...ROOM });

    const sdk = fakeSdk();
    sdk.Share.sendDefault.mockImplementation(() => {
      throw new Error("Illegal argument for buttons");
    });
    fireEvent.pointerDown(kakaoButton());
    finishLoading(sdk);
    await waitFor(() => expect(sdk.isInitialized()).toBe(true));
    fireEvent.click(kakaoButton());
    await waitFor(() => expect(share).toHaveBeenCalledTimes(2));
    expect(track).not.toHaveBeenCalledWith("share_clicked", expect.objectContaining({ channel: "kakao" }));
  });
});
