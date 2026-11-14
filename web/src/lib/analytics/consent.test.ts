// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONSENT_KEY, CONSENT_VERSION, consentState, readChoice, subscribeConsent, writeChoice } from "./consent";
import { clearAnalyticsStorage } from "./visit";

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("동의 저장", () => {
  it("아무것도 고르지 않았으면 미동의(unset)", () => {
    expect(readChoice()).toBe("unset");
  });

  it("선택을 버전·시각과 함께 저장하고 다시 읽는다", () => {
    writeChoice("granted", new Date("2026-11-14T10:00:00Z"));
    expect(JSON.parse(window.localStorage.getItem(CONSENT_KEY) ?? "null")).toEqual({
      v: CONSENT_VERSION,
      status: "granted",
      at: "2026-11-14T10:00:00.000Z",
    });
    expect(readChoice()).toBe("granted");
    writeChoice("denied");
    expect(readChoice()).toBe("denied");
  });

  it("버전이 다르면 이전 선택은 무효라서 다시 묻는다", () => {
    window.localStorage.setItem(CONSENT_KEY, JSON.stringify({ v: CONSENT_VERSION - 1, status: "granted", at: "x" }));
    expect(readChoice()).toBe("unset");
    window.localStorage.setItem(CONSENT_KEY, JSON.stringify({ v: CONSENT_VERSION + 1, status: "granted", at: "x" }));
    expect(readChoice()).toBe("unset");
  });

  it("깨졌거나 알 수 없는 값, 읽을 수 없는 저장소는 미동의", () => {
    for (const raw of ["not json", "null", "[]", JSON.stringify({ v: CONSENT_VERSION, status: "yes" }), '"granted"']) {
      window.localStorage.setItem(CONSENT_KEY, raw);
      expect(readChoice(), raw).toBe("unset");
    }
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readChoice()).toBe("unset");
  });

  it("저장소를 쓸 수 없어도 던지지 않고 구독자에게 알린다", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const onChange = vi.fn();
    const off = subscribeConsent(onChange);
    expect(() => writeChoice("granted")).not.toThrow();
    expect(onChange).toHaveBeenCalledTimes(1);
    off();
  });

  it("같은 탭과 다른 탭(storage 이벤트)의 변화를 구독하고, 해제하면 더 알리지 않는다", () => {
    const onChange = vi.fn();
    const off = subscribeConsent(onChange);
    writeChoice("denied");
    expect(onChange).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new StorageEvent("storage", { key: CONSENT_KEY }));
    expect(onChange).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new StorageEvent("storage", { key: "other" }));
    expect(onChange).toHaveBeenCalledTimes(2);
    off();
    writeChoice("granted");
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});

describe("화면 상태", () => {
  it("키가 없는 빌드는 묻지 않는다(unavailable), 브라우저 추적 거부는 선택보다 앞선다", () => {
    expect(consentState(false, false)).toBe("unavailable");
    writeChoice("granted");
    expect(consentState(false, false)).toBe("unavailable");
    expect(consentState(true, true)).toBe("browser-declined");
    expect(consentState(true, false)).toBe("granted");
  });

  it("선택이 없으면 묻고(ask), 있으면 그 값", () => {
    expect(consentState(true, false)).toBe("ask");
    writeChoice("denied");
    expect(consentState(true, false)).toBe("denied");
  });
});

describe("철회 시 저장소 정리", () => {
  it("ph_ 식별자와 첫 방문 표시를 지우고 동의 기록·옵트아웃 표시·다른 값은 남긴다", () => {
    writeChoice("denied");
    window.localStorage.setItem("ph_phc_x_posthog", "{}");
    window.localStorage.setItem("bby.analytics.seen", "1");
    window.localStorage.setItem("__ph_opt_in_out_phc_x", "0");
    window.localStorage.setItem("banbanyeok:me", "{}");
    window.sessionStorage.setItem("ph_phc_x_posthog", "{}");
    clearAnalyticsStorage();
    expect(window.localStorage.getItem("ph_phc_x_posthog")).toBeNull();
    expect(window.localStorage.getItem("bby.analytics.seen")).toBeNull();
    expect(window.sessionStorage.getItem("ph_phc_x_posthog")).toBeNull();
    expect(window.localStorage.getItem("__ph_opt_in_out_phc_x")).toBe("0");
    expect(window.localStorage.getItem("banbanyeok:me")).toBe("{}");
    expect(readChoice()).toBe("denied");
  });
});
