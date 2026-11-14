// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readChoice, writeChoice } from "@/lib/analytics/consent";
import { ConsentBanner } from "./consent-banner";
import { ConsentSettings } from "./consent-settings";

// 통계가 켜진 빌드·브라우저 추적 거부 여부만 바꿔 가며 실제 동의 저장소(localStorage)를 쓴다.
const env = vi.hoisted(() => ({ available: true, declined: false, id: null as string | null }));
vi.mock("@/lib/analytics", async () => {
  const consent = await import("@/lib/analytics/consent");
  return {
    subscribeConsent: consent.subscribeConsent,
    currentConsentState: () => consent.consentState(env.available, env.declined),
    setAnalyticsConsent: (granted: boolean) => {
      consent.writeChoice(granted ? "granted" : "denied");
      if (!granted) env.id = null; // 철회하면 이 기기의 식별자가 지워진다
    },
    subscribeAnalytics: consent.subscribeConsent,
    currentAnalyticsId: () => env.id,
  };
});

beforeEach(() => {
  window.localStorage.clear();
  env.available = true;
  env.declined = false;
  env.id = null;
});

describe("동의 배너", () => {
  it("처음 방문하면 보이고, 동의·거부는 이름만 다르고 모양은 같다(같은 무게)", () => {
    render(<ConsentBanner />);
    const region = screen.getByRole("region", { name: /이용 통계를 모아도 될까요/ });
    expect(region).toHaveTextContent("출발역과 이름은 모으지 않아요");
    expect(region).toHaveTextContent("만 14세 이상");
    expect(screen.getByRole("link", { name: "개인정보 처리방침" })).toHaveAttribute("href", "/privacy");
    const accept = screen.getByRole("button", { name: "동의" });
    const reject = screen.getByRole("button", { name: "거부" });
    expect(accept.className).toBe(reject.className);
    expect(accept.parentElement).toBe(reject.parentElement);
    expect(screen.getAllByRole("button")).toHaveLength(2); // 닫기·나중에 같은 제3의 길이 없다
  });

  it("아무것도 누르지 않으면 미동의다(저장하지 않는다)", () => {
    render(<ConsentBanner />);
    expect(readChoice()).toBe("unset");
  });

  it("동의를 누르면 저장하고 사라진다", async () => {
    render(<ConsentBanner />);
    await userEvent.setup().click(screen.getByRole("button", { name: "동의" }));
    expect(readChoice()).toBe("granted");
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("거부를 누르면 저장하고 사라진다", async () => {
    render(<ConsentBanner />);
    await userEvent.setup().click(screen.getByRole("button", { name: "거부" }));
    expect(readChoice()).toBe("denied");
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("키보드로 고를 수 있다(Tab으로 이동, Enter로 선택)", async () => {
    const user = userEvent.setup();
    render(<ConsentBanner />);
    await user.tab(); // 링크
    await user.tab(); // 거부
    expect(screen.getByRole("button", { name: "거부" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "동의" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(readChoice()).toBe("granted");
  });

  it("이미 골랐거나, 통계가 꺼진 빌드이거나, 브라우저가 추적을 거부하면 묻지 않는다", () => {
    writeChoice("denied");
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
  it("현재 상태를 보이고 스위치로 동의·철회한다", async () => {
    const user = userEvent.setup();
    render(<ConsentSettings />);
    const toggle = screen.getByRole("switch", { name: "이용 통계 수집 동의" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(/아직 고르지 않음/)).toBeInTheDocument();

    await user.click(toggle);
    expect(readChoice()).toBe("granted");
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/동의함 — 이용 통계를 모으고 있어요/)).toBeInTheDocument();

    await user.click(toggle); // 한 번에 철회(확인 단계 없음)
    expect(readChoice()).toBe("denied");
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(/동의하지 않음/)).toBeInTheDocument();
  });

  it("동의한 뒤에는 이 브라우저의 통계 식별자를 보여 주고 복사할 수 있다(어디로도 보내지 않는다)", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    writeChoice("granted");
    env.id = "01a1d8e0-adf1-7b8b-b68b-16811547a84e";
    render(<ConsentSettings />);
    expect(screen.getByRole("textbox", { name: "이 브라우저의 통계 식별자" })).toHaveValue(env.id);
    await user.click(screen.getByRole("button", { name: "복사" }));
    expect(writeText).toHaveBeenCalledWith("01a1d8e0-adf1-7b8b-b68b-16811547a84e");
    expect(screen.getByRole("button", { name: "복사했어요" })).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("철회하면 지운 식별자를 이 화면에 남겨 삭제 요청에 쓰게 하고, 다시 켜면 치운다", async () => {
    const user = userEvent.setup();
    writeChoice("granted");
    env.id = "id-123";
    render(<ConsentSettings />);
    await user.click(screen.getByRole("switch", { name: "이용 통계 수집 동의" }));
    expect(readChoice()).toBe("denied");
    expect(screen.getByRole("textbox", { name: "방금 지운 통계 식별자" })).toHaveValue("id-123");
    expect(screen.queryByRole("textbox", { name: "이 브라우저의 통계 식별자" })).toBeNull();
    await user.click(screen.getByRole("switch", { name: "이용 통계 수집 동의" }));
    expect(screen.queryByRole("textbox", { name: "방금 지운 통계 식별자" })).toBeNull();
  });

  it("식별자가 없으면(동의 전·거부) 식별자 칸을 보이지 않는다", () => {
    render(<ConsentSettings />);
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("브라우저 추적 거부나 통계 꺼짐이면 이유를 알리고 스위치를 잠근다", () => {
    env.declined = true;
    const { unmount } = render(<ConsentSettings />);
    expect(screen.getByRole("switch")).toBeDisabled();
    expect(screen.getByText(/추적 거부 신호/)).toBeInTheDocument();
    unmount();

    env.declined = false;
    env.available = false;
    render(<ConsentSettings />);
    expect(screen.getByRole("switch")).toBeDisabled();
    expect(screen.getByText(/지금 이용 통계를 모으지 않아요/)).toBeInTheDocument();
  });
});
