// @vitest-environment jsdom
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readChoice, readScopes, writeChoice } from "@/lib/analytics/consent";
import { ConsentBanner } from "./consent-banner";
import { ConsentSettings } from "./consent-settings";
import { CONSENT_COPY, CONSENT_NOTICE } from "./consent-text";

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

const nav = vi.hoisted(() => ({ pathname: "/" as string | null }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

const BOTH = { collect: true, transfer: true };
const NONE = { collect: false, transfer: false };
const collectBox = () => screen.getByRole("checkbox", { name: /이용 통계 수집·이용에 동의/ });
const transferBox = () => screen.getByRole("checkbox", { name: /통계의 국외 이전에 동의/ });
/** 오른쪽 버튼. 둘 다 체크하면 "동의하고 닫기", 그 외에는 "이대로 닫기". */
const save = () => screen.getByRole("button", { name: /^(동의하고 닫기|이대로 닫기)$/ });
const rejectAll = () => screen.getByRole("button", { name: "모두 거부" });

beforeEach(() => {
  window.localStorage.clear();
  nav.pathname = "/";
  env.available = true;
  env.declined = false;
  env.id = null;
});

describe("동의 배너", () => {
  it("처음 방문하면 보이고 두 항목은 기본 해제다, 두 버튼은 모양이 같다(같은 무게)", () => {
    render(<ConsentBanner />);
    const region = screen.getByRole("region", { name: /이용 통계를 모아도 될까요/ });
    expect(region).toHaveTextContent("서비스 개선을 위해");
    expect(region).toHaveTextContent("통계에는 출발역과 이름이 들어가지 않아요");
    expect(region).toHaveTextContent("만 14세 이상만 동의할 수 있어요");
    expect(region).toHaveTextContent("동의하지 않아도 모든 기능을 그대로 쓸 수 있어요");
    // 처리방침 링크는 한 번만, 철회·변경 방법(통계 설정)으로 간다. 세부 고지는 같은 자리에서 펼친다('자세히 보기').
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/privacy#analytics-settings");
    expect(links[0]).toHaveTextContent("언제든 변경");
    expect(collectBox()).not.toBeChecked();
    expect(transferBox()).not.toBeChecked();
    expect(screen.queryByText("두 가지 모두 체크해야 통계를 모아요.")).toBeNull(); // 하나만 체크했을 때만 보인다
    expect(save()).toHaveTextContent("이대로 닫기");
    expect(save().className).toBe(rejectAll().className);
    expect(save().parentElement).toBe(rejectAll().parentElement);
    // X·나중에·모두 동의 같은 다른 길이 없다(그 밖의 단추는 세부 고지를 펼치는 '자세히 보기'뿐).
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "자세히 보기▾",
      "모두 거부",
      "이대로 닫기",
    ]);
  });

  it("/privacy에서는 띄우지 않는다(같은 동의를 고르는 통계 설정 카드가 있다). 다른 경로에서는 그대로 뜬다", () => {
    nav.pathname = "/privacy";
    const { unmount } = render(<ConsentBanner />);
    expect(screen.queryByRole("region", { name: /이용 통계를 모아도 될까요/ })).toBeNull();
    unmount();
    for (const pathname of ["/", "/result", "/privacy-policy", "/r/abc"]) {
      nav.pathname = pathname;
      const view = render(<ConsentBanner />);
      expect(screen.getByRole("region", { name: /이용 통계를 모아도 될까요/ })).toBeInTheDocument();
      view.unmount();
    }
  });

  it("체크박스는 위아래 한 줄씩이고, 줄 전체를 눌러도 체크된다(좌우 2칸이 아니다)", async () => {
    const user = userEvent.setup();
    render(<ConsentBanner />);
    // 두 체크박스는 같은 세로 묶음(flex-col)의 형제 라벨이다. 격자(grid) 열로 나란히 놓지 않는다.
    const rows = [collectBox().closest("label"), transferBox().closest("label")];
    expect(rows[0]?.parentElement).toBe(rows[1]?.parentElement);
    expect(rows[0]?.parentElement?.className).toContain("flex-col");
    expect(rows[0]?.parentElement?.className).not.toMatch(/\bgrid/);
    await user.click(screen.getByText("서비스 개선용 · 기능 이용·오류·속도 기록, 무작위 식별자")); // 설명 글자를 눌러도
    expect(collectBox()).toBeChecked();
  });

  it("아무것도 누르지 않으면 미동의다(저장하지 않는다)", () => {
    render(<ConsentBanner />);
    expect(readChoice()).toBe("unset");
  });

  it("두 항목을 모두 체크하면 버튼이 '동의하고 닫기'가 되고, 누르면 동의(켜짐)다", async () => {
    const user = userEvent.setup();
    render(<ConsentBanner />);
    await user.click(collectBox());
    await user.click(transferBox());
    expect(save()).toHaveTextContent("동의하고 닫기");
    expect(screen.queryByText("두 가지 모두 체크해야 통계를 모아요.")).toBeNull();
    await user.click(save());
    expect(readScopes()).toEqual(BOTH);
    expect(readChoice()).toBe("granted");
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("정확히 하나만 체크하면 안내가 보이고(aria-live), 이대로 닫아도 통계는 꺼져 있다", async () => {
    const user = userEvent.setup();
    const { container, unmount } = render(<ConsentBanner />);
    const live = container.querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();
    expect(live?.textContent).toBe(""); // 하나만 체크하기 전에는 안내 글자가 없다

    await user.click(collectBox()); // 수집·이용만 체크
    expect(live).toHaveTextContent("두 가지 모두 체크해야 통계를 모아요.");
    expect(save()).toHaveTextContent("이대로 닫기");
    await user.click(save());
    expect(readScopes()).toEqual({ collect: true, transfer: false });
    expect(readChoice()).toBe("denied"); // 통계는 꺼짐
    unmount();

    window.localStorage.clear();
    render(<ConsentBanner />);
    await user.click(transferBox()); // 국외 이전만 체크
    expect(screen.getByText("두 가지 모두 체크해야 통계를 모아요.")).toBeInTheDocument();
    await user.click(save());
    expect(readScopes()).toEqual({ collect: false, transfer: true });
    expect(readChoice()).toBe("denied");
  });

  it("국외 이전 설명은 방침 7항 표와 같다: 이전받는 자·국가·시기·방법·목적(이용 통계 분석)·보유 기간(1년)", () => {
    expect(CONSENT_COPY.transfer.detail).toContain("PostHog, Inc.");
    expect(CONSENT_COPY.transfer.detail).toContain("(미국)");
    expect(CONSENT_COPY.transfer.detail).toContain("이용할 때마다");
    expect(CONSENT_COPY.transfer.detail).toContain("암호화해");
    expect(CONSENT_COPY.transfer.detail).toContain("분석");
    expect(CONSENT_COPY.transfer.detail).toContain("1년 보관");
  });

  it("요약(목적·대표 항목·이전받는 자·국가·시기·방법·보유 기간·불이익 없음·연령)은 접히지 않고 늘 보인다(#114)", () => {
    render(<ConsentBanner />);
    const region = screen.getByRole("region", { name: /이용 통계를 모아도 될까요/ });
    // 제15조②·제22조(수집·이용): 목적, 항목, 보유 기간, 거부권과 불이익 없음 / 제22조의2: 만 14세
    // 제28조의8②(국외 이전): 항목(위 통계), 국가, 시기와 방법, 이전받는 자, 목적과 보유 기간, 거부 방법과 효과
    const required: Record<string, string> = {
      목적: "서비스 개선용",
      항목: "기능 이용·오류·속도 기록, 무작위 식별자",
      "보유 기간": "1년 보관",
      "거부해도 불이익 없음": "동의하지 않아도 모든 기능을 그대로 쓸 수 있어요",
      연령: "만 14세 이상만 동의할 수 있어요",
      "이전받는 자": "PostHog, Inc.",
      국가: "(미국)",
      시기: "이용할 때마다",
      방법: "암호화해 보내",
      "이전 목적": "분석하고",
      "거부 방법": "모두 거부",
    };
    const notice = document.getElementById(
      within(region)
        .getByRole("button", { name: /자세히 보기/ })
        .getAttribute("aria-controls") ?? "",
    );
    for (const [what, text] of Object.entries(required)) {
      expect(region, what).toHaveTextContent(text);
      // 접거나(details) 숨긴(hidden·aria-hidden) 곳에 있지 않다.
      // 이 글자를 담은 가장 안쪽 요소(괄호 묶음 span처럼 글자가 여러 요소로 나뉘어도 찾는다).
      // 접힌 세부 고지(두 번째 층)에 같은 말이 있어도 요약 쪽 글자를 본다.
      const holder = within(region)
        .queryAllByText(
          (_, el) =>
            !notice?.contains(el) &&
            (el?.textContent ?? "").includes(text) &&
            ![...(el?.children ?? [])].some((child) => (child.textContent ?? "").includes(text)),
        )
        .at(0);
      expect(holder, what).toBeDefined();
      expect(holder, what).toBeVisible();
      expect(holder?.closest("details,[hidden],[aria-hidden='true']"), what).toBeNull();
    }
  });

  it("'자세히 보기'를 한 번 누르면 같은 자리에서 법정 고지 사항 전부가 펼쳐지고, 고른 체크는 그대로다(#116)", async () => {
    const user = userEvent.setup();
    render(<ConsentBanner />);
    const region = screen.getByRole("region", { name: /이용 통계를 모아도 될까요/ });
    const toggle = within(region).getByRole("button", { name: /자세히 보기/ });
    const notice = document.getElementById(toggle.getAttribute("aria-controls") ?? "") as HTMLElement;
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(notice).not.toBeVisible();
    await user.click(transferBox());
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(notice).toBeVisible();
    expect(region).toContainElement(notice); // 다른 화면으로 가지 않는다
    expect(transferBox()).toBeChecked();
    // 제15조②(목적·항목·보유 기간·거부 권리와 불이익), 제28조의8②(이전받는 자와 연락처·국가·항목·시기와 방법·목적과 보유 기간·거부 방법과 효과)
    for (const text of [
      "서비스 개선",
      "기능 이용·오류·속도 기록",
      "무작위 식별자",
      "브라우저·운영체제·기기 종류",
      "화면 크기",
      "방문한 페이지와 직전 페이지 주소",
      "접속 IP 주소",
      "수집한 날부터 1년",
      "동의하지 않아도 모든 기능을 그대로 쓸 수 있어요",
      "PostHog, Inc.",
      "privacy@posthog.com",
      "미국",
      "위 수집 항목 전부",
      "이용할 때마다 암호화된 네트워크",
      "이용 통계 분석, 수집한 날부터 1년",
      "통계 설정에서 언제든 철회",
    ]) {
      expect(notice, text).toHaveTextContent(text);
    }
    await user.click(toggle);
    expect(notice).not.toBeVisible();
  });

  it("세부 고지는 두 묶음(수집·이용, 국외 이전)에 법정 고지 사항을 하나씩 적는다", () => {
    expect(CONSENT_NOTICE.map((group) => [group.title, group.rows.map((row) => row.term)])).toEqual([
      ["이용 통계 수집·이용", ["목적", "항목", "보유 기간", "거부할 권리"]],
      [
        "통계의 국외 이전",
        ["이전받는 자", "이전되는 국가", "이전되는 항목", "시기와 방법", "목적과 보유 기간", "거부 방법과 효과"],
      ],
    ]);
  });

  it("안심할 사실이 세부 고지보다 먼저 온다: 질문 → 출발역·이름 없음·불이익 없음 → 체크박스(국외 이전 세부) → 연령·링크", () => {
    render(<ConsentBanner />);
    const precedes = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const question = screen.getByRole("heading", { name: CONSENT_COPY.question });
    const reassure = screen.getByText(CONSENT_COPY.reassure[0]);
    const noPenalty = screen.getByText(CONSENT_COPY.reassure[1]);
    const transferDetail = document.getElementById(transferBox().getAttribute("aria-describedby") ?? "") as HTMLElement;
    expect(transferDetail).toHaveTextContent(CONSENT_COPY.transfer.detail);
    const link = screen.getByRole("link");
    const toggle = screen.getByRole("button", { name: /자세히 보기/ });
    expect(precedes(question, reassure)).toBe(true);
    expect(precedes(noPenalty, collectBox())).toBe(true);
    expect(precedes(collectBox(), transferBox())).toBe(true);
    expect(precedes(transferDetail, toggle)).toBe(true);
    expect(precedes(toggle, link)).toBe(true);
    // 질문과 안심 문구, 체크박스 라벨에는 '미국'이 없다(국가는 국외 이전 세부 줄에 이유와 함께 있다).
    for (const text of [
      CONSENT_COPY.question,
      ...CONSENT_COPY.reassure,
      CONSENT_COPY.collect.label,
      CONSENT_COPY.transfer.label,
    ]) {
      expect(text).not.toContain("미국");
    }
    // 두 항목 모두 '(선택)'임을 라벨에서 밝힌다.
    expect(CONSENT_COPY.collect.label).toContain("(선택)");
    expect(CONSENT_COPY.transfer.label).toContain("(선택)");
  });

  it("체크박스는 라벨로 이름을, 세부 고지로 설명을 갖는다(화면 낭독기가 둘 다 읽는다)", () => {
    render(<ConsentBanner />);
    expect(collectBox()).toHaveAccessibleName(CONSENT_COPY.collect.label);
    expect(collectBox()).toHaveAccessibleDescription(CONSENT_COPY.collect.detail);
    expect(transferBox()).toHaveAccessibleName(CONSENT_COPY.transfer.label);
    expect(transferBox()).toHaveAccessibleDescription(CONSENT_COPY.transfer.detail);
  });

  it("안내 줄 자리는 늘 잡혀 있어(하나만 체크해도 높이가 같다) 체크박스가 밀리지 않는다", async () => {
    const user = userEvent.setup();
    const { container } = render(<ConsentBanner />);
    const hint = container.querySelector('[aria-live="polite"] > p');
    expect(hint).not.toBeNull();
    expect(hint?.className).toContain("min-h-[17px]");
    expect(hint).toBeEmptyDOMElement();
    await user.click(collectBox());
    expect(hint).toHaveTextContent("두 가지 모두 체크해야 통계를 모아요.");
    expect(container.querySelector('[aria-live="polite"] > p')).toBe(hint); // 같은 요소를 그대로 쓴다
  });

  it("체크를 다시 풀거나 둘 다 체크하면 안내가 사라진다", async () => {
    const user = userEvent.setup();
    render(<ConsentBanner />);
    const hint = () => screen.queryByText("두 가지 모두 체크해야 통계를 모아요.");
    await user.click(collectBox());
    expect(hint()).not.toBeNull();
    await user.click(transferBox());
    expect(hint()).toBeNull();
    await user.click(collectBox());
    expect(hint()).not.toBeNull();
    await user.click(transferBox());
    expect(hint()).toBeNull();
    expect(save()).toHaveTextContent("이대로 닫기");
  });

  it("기본값 그대로 이대로 닫으면 거부로 저장된다", async () => {
    const user = userEvent.setup();
    render(<ConsentBanner />);
    await user.click(save());
    expect(readScopes()).toEqual(NONE);
    expect(readChoice()).toBe("denied");
    expect(screen.queryByRole("region")).toBeNull();
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

  it("배너는 문서 끝에 자기 자리를 차지해 하단 여백이 생긴다(fixed가 아니라 in-flow sticky), 아래 안전 영역을 둔다", () => {
    render(<ConsentBanner />);
    const region = screen.getByRole("region", { name: /이용 통계를 모아도 될까요/ });
    // in-flow `sticky bottom-0`이라 맨 아래까지 스크롤하면 모든 입력·버튼이 배너 위에 온다(실제 위치는 e2e-analytics/banner-layout.spec.ts가 잰다).
    expect(region.className).toMatch(/\bsticky\b/);
    expect(region.className).toMatch(/\bbottom-0\b/);
    expect(region.className).not.toMatch(/\bfixed\b|\babsolute\b/);
    expect(region.className).toContain("safe-area-inset-bottom");
  });

  it("키보드로 고를 수 있다(화면 순서대로 Tab: 체크박스 → 자세히 → 링크 → 버튼, Space로 체크, Enter로 펼치고 저장)", async () => {
    const user = userEvent.setup();
    render(<ConsentBanner />);
    await user.tab();
    expect(collectBox()).toHaveFocus();
    await user.keyboard(" ");
    await user.tab();
    expect(transferBox()).toHaveFocus();
    await user.keyboard(" ");
    await user.tab();
    const toggle = screen.getByRole("button", { name: /자세히 보기/ });
    expect(toggle).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.tab();
    expect(screen.getByRole("link")).toHaveFocus();
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

  it("화면 키보드로 글자를 치는 동안에는 숨어 입력 칸을 가리지 않고, 고른 체크는 남는다", async () => {
    const user = userEvent.setup();
    const vv = Object.assign(new EventTarget(), { height: 800, scale: 1 });
    Object.defineProperty(window, "visualViewport", { configurable: true, value: vv });
    Object.defineProperty(document.documentElement, "clientHeight", { configurable: true, value: 800 });
    try {
      render(
        <>
          <input aria-label="역 이름" />
          <ConsentBanner />
        </>,
      );
      await user.click(collectBox());
      act(() => {
        screen.getByRole("textbox", { name: "역 이름" }).focus();
        vv.height = 380; // 키보드가 올라와 보이는 영역이 줄었다
        vv.dispatchEvent(new Event("resize"));
      });
      expect(screen.queryByRole("region")).toBeNull(); // aria-hidden이라 접근성 트리에서도 빠진다
      const hiddenBanner = document.querySelector("section") as HTMLElement;
      expect(hiddenBanner).toHaveAttribute("aria-hidden", "true");
      expect(hiddenBanner).toHaveClass("invisible"); // hidden이 아니라 자리는 그대로(높이가 변하지 않는다)
      expect(hiddenBanner).not.toHaveAttribute("hidden");
      act(() => {
        screen.getByRole("textbox", { name: "역 이름" }).blur();
        vv.height = 800;
        vv.dispatchEvent(new Event("resize"));
      });
      expect(screen.getByRole("region", { name: /이용 통계를 모아도 될까요/ })).toBeVisible();
      expect(collectBox()).toBeChecked();
    } finally {
      Object.defineProperty(window, "visualViewport", { configurable: true, value: undefined });
    }
  });
});

describe("통계 설정(/privacy)", () => {
  it("배너를 대신하므로 동의 요건을 모두 채운다: 두 항목 분리·기본 해제, 알릴 사항, 거부해도 불이익 없음", () => {
    render(<ConsentSettings />);
    const switches = screen.getAllByRole("switch");
    expect(switches).toHaveLength(2); // 수집·이용, 국외 이전을 따로 받는다
    for (const toggle of switches) expect(toggle).toHaveAttribute("aria-checked", "false"); // 기본 해제
    expect(screen.getByText("아직 고르지 않음 — 이용 통계를 모으지 않아요.")).toBeInTheDocument();
    const card = document.body;
    for (const text of [
      "통계에는 출발역과 이름이 들어가지 않아요", // 보내지 않는 것
      "만 14세 이상", // 연령
      "동의하지 않아도 모든 기능을 그대로 쓸 수 있어요", // 거부해도 불이익 없음
      "서비스 개선용 · 기능 이용·오류·속도 기록, 무작위 식별자", // 목적·항목
      "통계 도구 PostHog, Inc. (미국)에", // 국외 이전받는 자·국가
      "이용할 때마다 암호화해 보내 분석하고", // 시기·방법·목적
      "1년 보관", // 보유 기간
      "하나라도 끄면 바로 통계를 멈추고", // 철회는 한 번에
      // 세부 고지는 늘 펼쳐 둔다(배너의 '자세히 보기'와 같은 내용): 항목 전체, 이전받는 자의 연락처
      "브라우저·운영체제·기기 종류, 화면 크기, 방문한 페이지와 직전 페이지 주소",
      "PostHog, Inc. · 연락처 privacy@posthog.com",
      "수집한 날부터 1년",
    ]) {
      expect(card).toHaveTextContent(text);
    }
  });

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
    // 철회 전에 복사해 보내라는 안내(B안): 철회하면 이 기기에서 지워지므로
    expect(
      screen.getByText(/이미 모은 통계도 지우려면 철회하기 전에 이 값을 복사해 privacy@banbanyeok\.app/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "복사" }));
    expect(writeText).toHaveBeenCalledWith("01a1d8e0-adf1-7b8b-b68b-16811547a84e");
    expect(screen.getByRole("button", { name: "복사했어요" })).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("어느 항목이든 해제하면 지운 식별자를 이 화면에 남겨 삭제 요청에 쓰게 하고(복사 가능), 다시 모두 켜면 치운다", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    writeChoice(BOTH);
    env.id = "id-123";
    render(<ConsentSettings />);
    await user.click(collectSwitch());
    expect(readChoice()).toBe("denied");
    expect(screen.getByRole("textbox", { name: "방금 지운 통계 식별자" })).toHaveValue("id-123");
    // 철회 직후에도 복사할 수 있다. 값은 메모리(화면 상태)에만 있고 저장소에는 쓰지 않는다.
    await user.click(screen.getByRole("button", { name: "복사" }));
    expect(writeText).toHaveBeenCalledWith("id-123");
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain("id-123");
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
    expect(screen.getByText(/브라우저의 추적 거부/)).toBeInTheDocument();
    unmount();

    env.declined = false;
    env.available = false;
    render(<ConsentSettings />);
    expect(collectSwitch()).toBeDisabled();
    expect(screen.getByText(/지금 이용 통계를 모으지 않아요/)).toBeInTheDocument();
  });
});
