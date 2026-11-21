// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PrivacyPage from "./page";
import { HISTORY, historyUrl, POLICY, PREVIEW_EFFECTIVE_DATE, REVISION_DATE, UPCOMING_POLICY } from "./policy";
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
 * 12월 5일 시행판(방 링크 미리보기)을 지금 판으로 옮긴 뒤(2단계 6번). 이 PR은 그 시행일 0시(KST) 뒤에 병합·배포한다는 전제다(초안 PR,
 * 제목 "[12-05 0시 이후 병합]"). 그 뒤 어느 날에 열어도 공지 없이 이 판이 나온다.
 */
describe("/privacy: 12월 5일 시행판을 옮긴 뒤", () => {
  it("예정 판이 없어 첫 화면 공지 띠와 요청 때 렌더(connection)가 꺼진다", () => {
    expect(UPCOMING_POLICY).toBeNull();
  });

  it.each([
    kst(PREVIEW_EFFECTIVE_DATE), // 시행 0시 정각
    kst(PREVIEW_EFFECTIVE_DATE, 12 * 3_600_000),
    kst(PREVIEW_EFFECTIVE_DATE, 30 * DAY), // 병합·배포가 늦어진 경우
  ])("%s: 공지 없이 이 판(방 링크 미리보기에 막차·지도 한가운데)을 보여 준다", async (now) => {
    expect(resolvePolicy(POLICY, UPCOMING_POLICY, now)).toEqual({ policy: POLICY, notice: null });
    await renderPageAt(now);
    expect(document.getElementById("policy-notice")).toBeNull();
    const main = screen.getByRole("main");
    expect(main).toHaveTextContent(effectiveLine(PREVIEW_EFFECTIVE_DATE));
    expect(main).toHaveTextContent("미리보기 그림에는 출발역을 공개한 참여자의 귀갓길 막차 시각도 작은 줄로 보입니다");
  });

  it("15항의 이전 판 이름은 눌러 열 수 있는 링크다(설명 보완판 보존본 포함)", async () => {
    await renderPageAt(kst(PREVIEW_EFFECTIVE_DATE));
    const changes = document.getElementById("changes");
    const links = Array.from(changes?.querySelectorAll("a") ?? []);
    expect(links.map((a) => a.textContent)).toEqual([
      "2026년 11월 17일 최초 시행판",
      "2026년 11월 17일 첫 번째 개정판",
      "2026년 11월 17일 두 번째 개정판",
      "2026년 11월 17일 세 번째 개정판",
      "2026년 11월 28일 시행판",
      `${koreanDate(REVISION_DATE, { year: true })} 설명 보완판`,
    ]);
    expect(links[4]?.getAttribute("href")).toBe(historyUrl(HISTORY.threeStepRule.file));
    expect(links[5]?.getAttribute("href")).toBe(historyUrl(HISTORY.revision.file));
    expect(changes).not.toHaveTextContent("](https://");
  });
});
