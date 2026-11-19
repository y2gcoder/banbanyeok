// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PolicyNoticeStrip } from "./policy-notice-strip";
import { FIXTURE_UPCOMING, KST_BOUNDARIES } from "./upcoming.fixture";

const { noticeFrom, effectiveDate } = FIXTURE_UPCOMING;

function renderAt(now: Date) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  return render(<PolicyNoticeStrip noticeFrom={noticeFrom} effectiveDate={effectiveDate} />);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("첫 화면 공지 띠", () => {
  it("공지 시작 전에는 보이지 않는다", () => {
    const { container } = renderAt(KST_BOUNDARIES.beforeNotice);
    expect(container).toBeEmptyDOMElement();
  });

  it("공지 기간에는 시행일과 /privacy 공지 상자로 가는 링크를 보여 준다", () => {
    renderAt(KST_BOUNDARIES.noticeStart);
    expect(screen.getByText("개인정보 처리방침이 12월 20일부터 바뀝니다")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "자세히" })).toHaveAttribute("href", "/privacy#policy-notice");
  });

  it("시행일 전날 마지막 순간까지 보이고, 시행일 0시(KST)에 사라진다", () => {
    const last = renderAt(KST_BOUNDARIES.lastNoticeSecond);
    expect(screen.getByRole("link", { name: "자세히" })).toBeInTheDocument();
    last.unmount();

    const first = renderAt(KST_BOUNDARIES.effectiveStart);
    expect(first.container).toBeEmptyDOMElement();
  });

  it("서버 렌더 결과(정적 HTML)에는 공지가 없다", async () => {
    const { renderToString } = await import("react-dom/server");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(KST_BOUNDARIES.noticeStart);
    expect(renderToString(<PolicyNoticeStrip noticeFrom={noticeFrom} effectiveDate={effectiveDate} />)).toBe("");
  });
});
