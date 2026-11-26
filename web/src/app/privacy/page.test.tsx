// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PrivacyPage from "./page";
import { CHANGE_NOTICE, HISTORY, historyUrl, POLICY, REVISION_DATE, UPCOMING_POLICY } from "./policy";
import { koreanDate, resolvePolicy } from "./schedule";

// 예정 판이 있으면 페이지가 요청 때 렌더(connection)된다. 시험에서는 요청 범위가 없으므로 비운다.
vi.mock("next/server", () => ({ connection: async () => {} }));

vi.mock("@/lib/analytics", async () => {
  const consent = await import("@/lib/analytics/consent");
  return {
    subscribeConsent: consent.subscribeConsent,
    currentConsentState: () => consent.consentState(false, false),
    currentConsentScopes: () => "00",
    setAnalyticsConsent: () => {},
    subscribeAnalytics: consent.subscribeConsent,
    currentAnalyticsId: () => null,
  };
});

afterEach(() => {
  vi.useRealTimers();
});

/** `iso`(YYYY-MM-DD) 날짜의 한국 시간 0시에서 `ms`만큼 지난 때. */
const kst = (iso: string, ms = 0) => new Date(Date.parse(`${iso}T00:00:00+09:00`) + ms);
const DAY = 86_400_000;

async function renderPageAt(now: Date) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  return render(await PrivacyPage());
}

const effectiveLine = (iso: string) => `이 개인정보 처리방침은 ${koreanDate(iso, { year: true })}부터 적용됩니다.`;

/**
 * 이 판(REVISION_DATE)은 병합·배포하는 날 바로 시행한다. 다른 사람에게 보이는 범위가 바뀌는 중요한 변경이라 시행일부터 7일 동안
 * /privacy 맨 위에 안내 상자(전후 비교표)를 보여 주고, 그 뒤에는 재배포 없이 사라진다.
 */
describe("/privacy: 바로 시행한 판과 중요한 변경 안내", () => {
  it("예정 판은 없고 중요한 변경 안내가 있다(요청 때 렌더)", () => {
    expect(UPCOMING_POLICY).toBeNull();
    expect(CHANGE_NOTICE).not.toBeNull();
  });

  it.each([
    kst(REVISION_DATE), // 시행 0시 정각
    kst(REVISION_DATE, 12 * 3_600_000),
    kst(CHANGE_NOTICE?.until ?? REVISION_DATE, DAY - 1000), // 안내 마지막 날 23:59:59
  ])("%s: 이 판 위에 중요한 변경 안내 상자(비교표·직전 판 링크)가 있다", async (now) => {
    expect(resolvePolicy(POLICY, UPCOMING_POLICY, now)).toEqual({ policy: POLICY, notice: null });
    await renderPageAt(now);
    const box = document.getElementById("policy-change");
    expect(box).not.toBeNull();
    expect(box).toHaveTextContent(`개인정보 처리방침이 ${koreanDate(REVISION_DATE, { year: true })}부터 바뀌었습니다`);
    expect(box).toHaveTextContent("방 미리보기 응답: 방 ID만 있으면 누구나 받는 값 (6항)");
    expect(box?.querySelector("a")?.getAttribute("href")).toBe(CHANGE_NOTICE?.previous.url);
    expect(document.getElementById("policy-notice")).toBeNull();
    const main = screen.getByRole("main");
    expect(main).toHaveTextContent(effectiveLine(REVISION_DATE));
    expect(main).toHaveTextContent(
      "약속 이후에 탈 수 있는 막차는 그 시각 또는 여유 시각을 미리보기 그림에 작은 줄로 표시할 수 있습니다",
    );
  });

  it.each([
    kst(CHANGE_NOTICE?.until ?? REVISION_DATE, DAY), // 안내 기간 다음 날 0시
    kst(REVISION_DATE, 60 * DAY),
  ])("%s: 안내 기간이 지나면 상자 없이 이 판만 보인다", async (now) => {
    await renderPageAt(now);
    expect(document.getElementById("policy-change")).toBeNull();
    expect(screen.getByRole("main")).toHaveTextContent(effectiveLine(REVISION_DATE));
  });

  it("15항의 판 이름은 눌러 열 수 있는 링크다(11월 28일 예정 판은 시행하지 않았다고 표기)", async () => {
    await renderPageAt(kst(REVISION_DATE, 30 * DAY));
    const changes = document.getElementById("changes");
    const links = Array.from(changes?.querySelectorAll("a") ?? []);
    expect(links.map((a) => a.textContent)).toEqual([
      "2026년 11월 17일 최초 시행판",
      "2026년 11월 17일 첫 번째 개정판",
      "2026년 11월 17일 두 번째 개정판",
      "2026년 11월 17일 세 번째 개정판",
      "2026년 11월 28일 시행 예정 판(시행하지 않음)",
      "2026년 11월 21일 시행판",
      "2026년 11월 24일 시행판",
      "2026년 11월 24일 개정판",
      "2026년 11월 25일 시행판",
      "2026년 11월 25일 개정판",
    ]);
    expect(links[4]?.getAttribute("href")).toBe(historyUrl(HISTORY.withdrawn.file));
    expect(changes).not.toHaveTextContent("](https://");
  });
});
