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
const SECOND = 1000;
const DAY = 86_400_000;

async function renderPageAt(now: Date) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  return render(await PrivacyPage());
}

const effectiveLine = (iso: string) => `이 개인정보 처리방침은 ${koreanDate(iso, { year: true })}부터 적용됩니다.`;

/**
 * 이 판(설명 보완판, 15항 1단계)은 배포하는 날(`REVISION_DATE`, 기본 11-28) 바로 시행하고, 같은 배포로 다음 판(방 링크 미리보기,
 * 15항 2단계)의 공지를 시작한다. 시행일(`PREVIEW_EFFECTIVE_DATE`, 기본 12-05) 0시(KST)에 재배포 없이 다음 판이 지금 판이 된다.
 */
describe("/privacy: 설명 보완판 + 다음 판 공지", () => {
  it.each([
    kst(REVISION_DATE), // 공지 시작 0시 정각
    kst(REVISION_DATE, 12 * 3_600_000), // 그날 낮
    kst(PREVIEW_EFFECTIVE_DATE, -SECOND), // 시행 전날 23:59:59
  ])("%s: 설명 보완판 위에 다음 판 공지 상자(전후 비교표)가 있다", async (now) => {
    expect(resolvePolicy(POLICY, UPCOMING_POLICY, now)).toEqual({ policy: POLICY, notice: UPCOMING_POLICY });
    await renderPageAt(now);
    const notice = document.getElementById("policy-notice");
    expect(notice).not.toBeNull();
    expect(notice).toHaveTextContent(
      `개인정보 처리방침이 ${koreanDate(PREVIEW_EFFECTIVE_DATE, { year: true })}부터 바뀝니다`,
    );
    expect(notice).toHaveTextContent("메신저 미리보기 그림 (6항)");
    expect(notice).toHaveTextContent("방 미리보기 응답: 방 ID만 있으면 누구나 받는 값 (6항)");
    const main = screen.getByRole("main");
    expect(main).toHaveTextContent(effectiveLine(REVISION_DATE));
    expect(main).toHaveTextContent("보내는 때의 방 상태가 보입니다");
    expect(main).not.toHaveTextContent("미리보기 그림에는 출발역을 공개한 참여자의 귀갓길 막차 시각");
  });

  it.each([
    kst(PREVIEW_EFFECTIVE_DATE), // 시행 0시 정각
    kst(PREVIEW_EFFECTIVE_DATE, 10 * DAY), // 정리(POLICY로 옮기기)가 늦어진 경우
  ])("%s: 공지 없이 다음 판(방 링크 미리보기)을 보여 준다", async (now) => {
    expect(resolvePolicy(POLICY, UPCOMING_POLICY, now)).toEqual({ policy: UPCOMING_POLICY?.policy, notice: null });
    await renderPageAt(now);
    expect(document.getElementById("policy-notice")).toBeNull();
    const main = screen.getByRole("main");
    expect(main).toHaveTextContent(effectiveLine(PREVIEW_EFFECTIVE_DATE));
    expect(main).toHaveTextContent("미리보기 그림에는 출발역을 공개한 참여자의 귀갓길 막차 시각도 작은 줄로 보입니다");
  });

  it("공지 시작 전(배포가 이른 경우)에는 공지 없이 설명 보완판만 보인다", async () => {
    const now = kst(REVISION_DATE, -SECOND);
    expect(resolvePolicy(POLICY, UPCOMING_POLICY, now)).toEqual({ policy: POLICY, notice: null });
    await renderPageAt(now);
    expect(document.getElementById("policy-notice")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: POLICY.title })).toBeInTheDocument();
  });

  it("15항의 이전 판 이름은 눌러 열 수 있는 링크다", async () => {
    await renderPageAt(kst(REVISION_DATE));
    const changes = document.getElementById("changes");
    const links = Array.from(changes?.querySelectorAll("a") ?? []);
    expect(links.map((a) => a.textContent)).toEqual([
      "2026년 11월 17일 최초 시행판",
      "2026년 11월 17일 첫 번째 개정판",
      "2026년 11월 17일 두 번째 개정판",
      "2026년 11월 17일 세 번째 개정판",
      "2026년 11월 28일 시행판",
    ]);
    expect(links[4]?.getAttribute("href")).toBe(historyUrl(HISTORY.threeStepRule.file));
    expect(changes).not.toHaveTextContent("](https://");
  });
});
