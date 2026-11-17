// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
/** 이 방과 이용자의 글자. 공유 칸이 보일 때 카카오로 가는 확인에는 하나도 없어야 한다. */
const ROOM_STRINGS = ["qt7yvmsht3", "강남", "민수", "22분", "공평", "출발역", "sv=5", "/r/"];

const scripts = () => document.querySelectorAll('script[src*="kakaocdn"]');
const kakaoButton = () => screen.getByRole("button", { name: /카톡으로 결과 보내기/ });

/** `accepts`가 거짓이면 카카오가 확인을 거절한다(앱 키·도메인 설정 오류, 카카오에 못 닿음 등). */
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

/** 브라우저의 IntersectionObserver 대신. `showShareArea()`가 공유 칸이 화면에 들어온 것처럼 알린다. */
class FakeIntersectionObserver {
  static all: FakeIntersectionObserver[] = [];
  readonly targets = new Set<Element>();
  disconnected = false;
  constructor(private readonly callback: IntersectionObserverCallback) {
    FakeIntersectionObserver.all.push(this);
  }
  observe(target: Element) {
    this.targets.add(target);
  }
  unobserve(target: Element) {
    this.targets.delete(target);
  }
  disconnect() {
    this.disconnected = true;
    this.targets.clear();
  }
  takeRecords() {
    return [];
  }
  notify(isIntersecting: boolean) {
    if (this.disconnected) return;
    const entries = [...this.targets].map((target) => ({ target, isIntersecting }) as IntersectionObserverEntry);
    if (entries.length > 0) this.callback(entries, this as unknown as IntersectionObserver);
  }
}

const watching = () => FakeIntersectionObserver.all.filter((observer) => observer.targets.size > 0);
const showShareArea = () => {
  for (const observer of watching()) observer.notify(true);
};

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

/** 공유 칸이 보여 SDK를 받고 카카오 확인이 끝날 때까지. */
async function becomeReady(sdk = fakeSdk()) {
  showShareArea();
  expect(scripts()).toHaveLength(1);
  finishLoading(sdk);
  await waitFor(() => expect(sdk.API.request).toHaveBeenCalledTimes(1));
  await new Promise((resolve) => setTimeout(resolve, 0));
  return sdk;
}

const share = vi.fn(async () => {});

beforeEach(() => {
  for (const script of scripts()) script.remove();
  delete window.Kakao;
  share.mockClear();
  FakeIntersectionObserver.all = [];
  Object.defineProperty(navigator, "share", { value: share, configurable: true });
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const ROOM = { link_type: "room", room_hash: "0123456789abcdef", room_stage: "result" };

describe("카톡으로 보내기", () => {
  it("빌드에 카카오 앱 키가 없으면 공유 칸이 보여도 카카오 SDK를 받지 않고 지금처럼 공유 시트를 연다", async () => {
    vi.stubEnv("NEXT_PUBLIC_KAKAO_JS_KEY", "");
    const track = await renderShare();
    showShareArea();
    fireEvent.click(kakaoButton());

    expect(share).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledWith({
      title: "지금은 강남이 제일 공평해요",
      text: "아직이면 출발역 넣어 주세요 · 민수 22분",
      url: `${window.location.origin}/r/qt7yvmsht3?sv=5`,
    });
    expect(track).toHaveBeenCalledWith("share_clicked", { channel: "system", ...ROOM });
    expect(scripts()).toHaveLength(0);
    expect(watching()).toHaveLength(0);
  });

  it("공유 칸이 보이기 전에는 카카오로 아무것도 가지 않는다", async () => {
    vi.stubEnv("NEXT_PUBLIC_KAKAO_JS_KEY", KEY);
    await renderShare();
    for (const observer of watching()) observer.notify(false);
    expect(scripts()).toHaveLength(0);
  });

  it("보이면 SDK와 내용 없는 확인 하나만 보내고, 누르면 그 클릭 안에서 이 방의 메시지를 카카오톡 공유 API로 보낸다", async () => {
    vi.stubEnv("NEXT_PUBLIC_KAKAO_JS_KEY", KEY);
    const track = await renderShare();
    const sdk = await becomeReady();

    expect(sdk.API.request).toHaveBeenCalledTimes(1);
    const check = JSON.stringify(sdk.API.request.mock.calls[0]);
    for (const text of ROOM_STRINGS) expect(check, text).not.toContain(text);
    expect(sdk.Share.sendDefault).not.toHaveBeenCalled();
    expect(watching()).toHaveLength(0);

    fireEvent.click(kakaoButton());
    expect(sdk.Share.sendDefault).toHaveBeenCalledTimes(1);
    const origin = window.location.origin;
    const link = { webUrl: `${origin}/r/qt7yvmsht3?sv=5`, mobileWebUrl: `${origin}/r/qt7yvmsht3?sv=5` };
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
    expect(sdk.API.request).toHaveBeenCalledTimes(1);
  });

  it("아직 준비 중일 때 누르면 기다리지 않고 그 클릭 안에서 공유 시트를 열고, 페이지는 그대로다", async () => {
    vi.stubEnv("NEXT_PUBLIC_KAKAO_JS_KEY", KEY);
    const track = await renderShare();
    const pageUrl = window.location.href;
    showShareArea();
    fireEvent.click(kakaoButton());

    expect(share).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("share_clicked", { channel: "system", ...ROOM });
    expect(kakaoButton()).not.toHaveAttribute("aria-busy");

    const sdk = fakeSdk();
    finishLoading(sdk);
    await waitFor(() => expect(sdk.API.request).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sdk.Share.sendDefault).not.toHaveBeenCalled();
    expect(window.location.href).toBe(pageUrl);
    expect(track).toHaveBeenCalledTimes(1);
  });

  it("카카오가 확인을 거절했으면 누름은 공유 시트로 가고 이 방의 메시지는 카카오로 가지 않으며, 다시 확인받아 다음 누름은 카카오로 간다", async () => {
    vi.stubEnv("NEXT_PUBLIC_KAKAO_JS_KEY", KEY);
    const track = await renderShare();
    const sdk = await becomeReady(fakeSdk({ accepts: false }));

    fireEvent.click(kakaoButton());
    expect(share).toHaveBeenCalledTimes(1);
    expect(sdk.Share.sendDefault).not.toHaveBeenCalled();
    expect(track).toHaveBeenLastCalledWith("share_clicked", { channel: "system", ...ROOM });

    await waitFor(() => expect(sdk.API.request).toHaveBeenCalledTimes(2));
    for (const [call] of sdk.API.request.mock.calls) {
      for (const text of ROOM_STRINGS) expect(JSON.stringify(call), text).not.toContain(text);
    }
    sdk.API.request.mockResolvedValue({});
    fireEvent.click(kakaoButton());
    expect(share).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(sdk.API.request).toHaveBeenCalledTimes(3));
    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.click(kakaoButton());
    expect(sdk.Share.sendDefault).toHaveBeenCalledTimes(1);
  });

  it("SDK를 못 받았거나 SDK가 보내기를 거부하면 그 누름은 공유 시트로 간다", async () => {
    vi.stubEnv("NEXT_PUBLIC_KAKAO_JS_KEY", KEY);
    const track = await renderShare();
    showShareArea();
    scripts()[0]?.dispatchEvent(new Event("error"));
    await waitFor(() => expect(scripts()).toHaveLength(0));
    fireEvent.click(kakaoButton());
    expect(share).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenLastCalledWith("share_clicked", { channel: "system", ...ROOM });

    const sdk = fakeSdk();
    sdk.Share.sendDefault.mockImplementation(() => {
      throw new Error("Illegal argument for buttons");
    });
    expect(scripts()).toHaveLength(1);
    finishLoading(sdk);
    await waitFor(() => expect(sdk.API.request).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.click(kakaoButton());
    expect(sdk.Share.sendDefault).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledTimes(2);
    expect(track).not.toHaveBeenCalledWith("share_clicked", expect.objectContaining({ channel: "kakao" }));
  });

  it("공유 칸이 보이기 전에 화면을 떠나면 지켜보기를 멈추고 카카오로 아무것도 보내지 않는다", async () => {
    vi.stubEnv("NEXT_PUBLIC_KAKAO_JS_KEY", KEY);
    const track = await renderShare();
    const [observer] = watching();
    cleanup();

    expect(observer?.disconnected).toBe(true);
    showShareArea();
    expect(scripts()).toHaveLength(0);
    expect(share).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
  });
});
