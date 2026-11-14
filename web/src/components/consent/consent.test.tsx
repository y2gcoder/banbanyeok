// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readChoice, readScopes, writeChoice } from "@/lib/analytics/consent";
import { ConsentBanner } from "./consent-banner";
import { ConsentSettings } from "./consent-settings";

// 통계가 켜진 빌드·브라우저 추적 거부 여부만 바꿔 가며 실제 동의 저장소(localStorage)를 쓴다.
const env = vi.hoisted(() => ({ available: true, declined: false, id: null as string | null }));
vi.mock("@/lib/analytics", async () => {
  const consent = await import("@/lib/analytics/consent");
  return {
    subscribeConsent: consent.subscribeConsent,
    currentConsentState: () => consent.consentState(env.available, env.declined),
    currentConsentScopes: () => {
      const { collect, transfer } = consent.readScopes();
      return `${collect ? 1 : 0}${transfer ? 1 : 0}`;
    },
    setAnalyticsConsent: (scopes: { collect: boolean; transfer: boolean }) => {
      consent.writeChoice(scopes);
      if (consent.readChoice() !== "granted") env.id = null; // 하나라도 해제하면 이 기기의 식별자가 지워진다
    },
    subscribeAnalytics: consent.subscribeConsent,
    currentAnalyticsId: () => env.id,
  };
});

const BOTH = { collect: true, transfer: true };
const NONE = { collect: false, transfer: false };
const collectBox = () => screen.getByRole("checkbox", { name: /이용 통계 수집·이용에 동의/ });
const transferBox = () => screen.getByRole("checkbox", { name: /미국 PostHog, Inc.로 보내는 데 동의/ });
const save = () => screen.getByRole("button", { name: "선택한 대로 저장" });
const rejectAll = () => screen.getByRole("button", { name: "모두 거부" });

beforeEach(() => {
  window.localStorage.clear();
  env.available = true;
  env.declined = false;
  env.id = null;
});

describe("동의 배너", () => {
  it("처음 방문하면 보이고 두 항목은 기본 해제다, 저장·거부 버튼은 모양이 같다(같은 무게)", () => {
    render(<ConsentBanner />);
    const region = screen.getByRole("region", { name: /이용 통계를 모아도 될까요/ });
    expect(region).toHaveTextContent("출발역과 이름은 모으지 않아요");
    expect(region).toHaveTextContent("만 14세 이상");
    expect(region).toHaveTextContent("모두 동의해야 통계를 모아요");
    expect(screen.getByRole("link", { name: "개인정보 처리방침" })).toHaveAttribute("href", "/privacy");
    expect(collectBox()).not.toBeChecked();
    expect(transferBox()).not.toBeChecked();
    expect(save().className).toBe(rejectAll().className);
    expect(save().parentElement).toBe(rejectAll().parentElement);
    expect(screen.getAllByRole("button")).toHaveLength(2); // 닫기·나중에·모두 동의 같은 다른 길이 없다
  });

  it("아무것도 누르지 않으면 미동의다(저장하지 않는다)", () => {
    render(<ConsentBanner />);
    expect(readChoice()).toBe("unset");
  });

  it("두 항목을 모두 체크하고 저장해야 동의다", async () => {
    const user = userEvent.setup();
    render(<ConsentBanner />);
    await user.click(collectBox());
    await user.click(transferBox());
    await user.click(save());
    expect(readScopes()).toEqual(BOTH);
    expect(readChoice()).toBe("granted");
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("기본값 그대로 저장하면 거부이고, 한 항목만 체크하면 통계를 켜지 않는다", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<ConsentBanner />);
    await user.click(save());
    expect(readScopes()).toEqual(NONE);
    expect(readChoice()).toBe("denied");
    unmount();

    window.localStorage.clear();
    render(<ConsentBanner />);
    await user.click(collectBox()); // 국외 이전은 동의하지 않음
    await user.click(save());
    expect(readScopes()).toEqual({ collect: true, transfer: false });
    expect(readChoice()).toBe("denied");
  });

  it("모두 거부를 누르면 체크 상태와 상관없이 거부로 저장하고 사라진다", async () => {
    const user = userEvent.setup();
    render(<ConsentBanner />);
    await user.click(collectBox());
    await user.click(transferBox());
    await user.click(rejectAll());
    expect(readScopes()).toEqual(NONE);
    expect(readChoice()).toBe("denied");
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("키보드로 고를 수 있다(Tab으로 이동, Space로 체크, Enter로 저장)", async () => {
    const user = userEvent.setup();
    render(<ConsentBanner />);
    await user.tab(); // 링크
    await user.tab();
    expect(collectBox()).toHaveFocus();
    await user.keyboard(" ");
    await user.tab();
    expect(transferBox()).toHaveFocus();
    await user.keyboard(" ");
    await user.tab();
    expect(rejectAll()).toHaveFocus();
    await user.tab();
    expect(save()).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(readChoice()).toBe("granted");
  });

  it("이미 골랐거나, 통계가 꺼진 빌드이거나, 브라우저가 추적을 거부하면 묻지 않는다", () => {
    writeChoice(NONE);
    const { unmount } = render(<ConsentBanner />);
    expect(screen.queryByRole("region")).toBeNull();
    unmount();

    window.localStorage.clear();
    env.available = false;
    const second = render(<ConsentBanner />);
    expect(screen.queryByRole("region")).toBeNull();
    second.unmount();

    env.available = true;
    env.declined = true;
    render(<ConsentBanner />);
    expect(screen.queryByRole("region")).toBeNull();
    expect(readChoice()).toBe("unset"); // 묻지 않고 기록도 만들지 않는다(미동의로만 취급)
  });
});

describe("통계 설정(/privacy)", () => {
  const collectSwitch = () => screen.getByRole("switch", { name: "이용 통계 수집·이용 동의" });
  const transferSwitch = () => screen.getByRole("switch", { name: /국외 이전 동의/ });

  it("현재 상태를 보이고 두 스위치가 모두 켜져야 동의, 하나라도 끄면 철회된다", async () => {
    const user = userEvent.setup();
    render(<ConsentSettings />);
    expect(collectSwitch()).toHaveAttribute("aria-checked", "false");
    expect(transferSwitch()).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(/아직 고르지 않음/)).toBeInTheDocument();

    await user.click(collectSwitch());
    expect(readScopes()).toEqual({ collect: true, transfer: false });
    expect(readChoice()).toBe("denied");
    expect(screen.getByText(/일부만 동의함/)).toBeInTheDocument();

    await user.click(transferSwitch());
    expect(readChoice()).toBe("granted");
    expect(screen.getByText(/모두 동의함 — 이용 통계를 모으고 있어요/)).toBeInTheDocument();

    await user.click(transferSwitch()); // 하나만 꺼도 한 번에 철회(확인 단계 없음)
    expect(readChoice()).toBe("denied");
    expect(readScopes()).toEqual({ collect: true, transfer: false });
    expect(screen.getByText(/일부만 동의함/)).toBeInTheDocument();
  });

  it("동의한 뒤에는 이 브라우저의 통계 식별자를 보여 주고 복사할 수 있다(어디로도 보내지 않는다)", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    writeChoice(BOTH);
    env.id = "01a1d8e0-adf1-7b8b-b68b-16811547a84e";
    render(<ConsentSettings />);
    expect(screen.getByRole("textbox", { name: "이 브라우저의 통계 식별자" })).toHaveValue(env.id);
    await user.click(screen.getByRole("button", { name: "복사" }));
    expect(writeText).toHaveBeenCalledWith("01a1d8e0-adf1-7b8b-b68b-16811547a84e");
    expect(screen.getByRole("button", { name: "복사했어요" })).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("어느 항목이든 해제하면 지운 식별자를 이 화면에 남겨 삭제 요청에 쓰게 하고, 다시 모두 켜면 치운다", async () => {
    const user = userEvent.setup();
    writeChoice(BOTH);
    env.id = "id-123";
    render(<ConsentSettings />);
    await user.click(collectSwitch());
    expect(readChoice()).toBe("denied");
    expect(screen.getByRole("textbox", { name: "방금 지운 통계 식별자" })).toHaveValue("id-123");
    expect(screen.queryByRole("textbox", { name: "이 브라우저의 통계 식별자" })).toBeNull();
    await user.click(collectSwitch());
    expect(screen.queryByRole("textbox", { name: "방금 지운 통계 식별자" })).toBeNull();
  });

  it("식별자가 없으면(동의 전·거부) 식별자 칸을 보이지 않는다", () => {
    render(<ConsentSettings />);
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("브라우저 추적 거부나 통계 꺼짐이면 이유를 알리고 스위치를 잠근다", () => {
    env.declined = true;
    const { unmount } = render(<ConsentSettings />);
    expect(collectSwitch()).toBeDisabled();
    expect(transferSwitch()).toBeDisabled();
    expect(screen.getByText(/추적 거부 신호/)).toBeInTheDocument();
    unmount();

    env.declined = false;
    env.available = false;
    render(<ConsentSettings />);
    expect(collectSwitch()).toBeDisabled();
    expect(screen.getByText(/지금 이용 통계를 모으지 않아요/)).toBeInTheDocument();
  });
});
