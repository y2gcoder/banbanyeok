// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PolicyChangeStrip, PolicyNoticeStrip } from "./policy-notice-strip";
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

describe("첫 화면 중요한 변경 안내 띠", () => {
  // 시험용 안내 기간: 2026-12-01 ~ 2026-12-07(한국 시간).
  const since = "2026-12-01";
  const until = "2026-12-07";
  const at = (iso: string) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(iso));
    return render(<PolicyChangeStrip since={since} until={until} />);
  };

  it("시행일 0시(KST)부터 끝나는 날 24시까지만 보이고, /privacy 안내 상자로 잇는다", () => {
    expect(at("2026-11-30T14:59:59Z").container).toBeEmptyDOMElement();
    cleanup();
    at("2026-11-30T15:00:00Z");
    expect(screen.getByText("개인정보 처리방침이 12월 1일부터 바뀌었습니다")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "자세히" })).toHaveAttribute("href", "/privacy#policy-change");
    cleanup();
    at("2026-12-07T14:59:59Z");
    expect(screen.getByRole("link", { name: "자세히" })).toBeInTheDocument();
    cleanup();
    expect(at("2026-12-07T15:00:00Z").container).toBeEmptyDOMElement();
  });

  it("열어 둔 탭도 안내 시작·끝 자정(KST)을 지나면 새로고침 없이 띠가 나타나고 사라진다", () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-11-30T14:59:55Z")); // 11-30 23:59:55 KST
    const view = render(<PolicyChangeStrip since={since} until={until} />);
    expect(view.container).toBeEmptyDOMElement();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByRole("link", { name: "자세히" })).toBeInTheDocument();
    // 같은 탭을 그대로 둔 채 마지막 날(12-07) 23:59:55까지 → 자정 뒤.
    act(() => {
      vi.advanceTimersByTime(Date.parse("2026-12-07T14:59:55Z") - Date.now());
    });
    expect(screen.getByRole("link", { name: "자세히" })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(view.container).toBeEmptyDOMElement();
  });

  it("타이머가 늦어도(잠자기·백그라운드 탭) 탭으로 돌아오면 날짜를 다시 읽는다", () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-11-30T10:00:00Z"));
    const view = render(<PolicyChangeStrip since={since} until={until} />);
    expect(view.container).toBeEmptyDOMElement();
    // 타이머를 돌리지 않고 시계만 다음 날로(잠자기에서 깨어난 탭).
    vi.setSystemTime(new Date("2026-12-01T01:00:00Z"));
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(screen.getByRole("link", { name: "자세히" })).toBeInTheDocument();
    vi.setSystemTime(new Date("2026-12-08T01:00:00Z"));
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(view.container).toBeEmptyDOMElement();
  });

  it("서버 렌더 결과(정적 HTML)에는 안내가 없다", async () => {
    const { renderToString } = await import("react-dom/server");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-12-02T00:00:00Z"));
    expect(renderToString(<PolicyChangeStrip since={since} until={until} />)).toBe("");
  });
});
