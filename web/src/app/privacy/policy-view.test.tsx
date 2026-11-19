// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { POLICY } from "./policy";
import { PolicyView } from "./policy-view";
import { resolvePolicy } from "./schedule";
import { FIXTURE_UPCOMING, KST_BOUNDARIES } from "./upcoming.fixture";

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

const renderAt = (now: Date) => render(<PolicyView {...resolvePolicy(POLICY, FIXTURE_UPCOMING, now)} />);
const title = (name: string) => screen.queryByRole("heading", { level: 1, name });

describe("/privacy의 공지 상자", () => {
  it("예정 판이 없으면 공지 상자가 없고 지금 판만 나온다", () => {
    render(<PolicyView {...resolvePolicy(POLICY, null, KST_BOUNDARIES.noticeStart)} />);
    expect(document.getElementById("policy-notice")).toBeNull();
    expect(title(POLICY.title)).toBeInTheDocument();
  });

  it("공지 시작 전에는 공지 상자가 없다", () => {
    renderAt(KST_BOUNDARIES.beforeNotice);
    expect(document.getElementById("policy-notice")).toBeNull();
  });

  it("공지 중에는 맨 위에 시행일·요약·전후 비교를 싣고, 그 아래에 지금 판을 그대로 보여 준다", () => {
    renderAt(KST_BOUNDARIES.lastNoticeSecond);
    const box = screen.getByRole("region", { name: "개인정보 처리방침이 2026년 12월 20일부터 바뀝니다" });
    expect(box).toBe(document.getElementById("policy-notice"));
    expect(box).toHaveTextContent("시행일은 2026년 12월 20일 0시(한국 시간)입니다.");
    expect(box).toHaveTextContent(FIXTURE_UPCOMING.summary);
    const rows = within(box).getByRole("list", { name: "바뀌기 전과 후 비교" });
    expect(within(rows).getByText("마지막 변경 후 7일")).toBeInTheDocument();
    expect(within(rows).getByText("마지막 변경 후 14일")).toBeInTheDocument();

    expect(title(POLICY.title)).toBeInTheDocument();
    expect(title(FIXTURE_UPCOMING.policy.title)).toBeNull();
    const main = screen.getByRole("main");
    expect(main.firstElementChild?.nextElementSibling?.firstElementChild).toBe(box);
  });

  it("시행일 0시(KST)에는 공지가 사라지고 다음 판이 지금 판으로 나온다", () => {
    renderAt(KST_BOUNDARIES.effectiveStart);
    expect(document.getElementById("policy-notice")).toBeNull();
    expect(title(FIXTURE_UPCOMING.policy.title)).toBeInTheDocument();
    expect(title(POLICY.title)).toBeNull();
  });
});
