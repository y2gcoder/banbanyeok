// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { track } from "@/lib/analytics";
import { HomeForm } from "./home-form";

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

describe("입력 화면", () => {
  beforeEach(() => {
    push.mockReset();
    vi.mocked(track).mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("ok"))),
    );
    window.localStorage.clear();
  });

  it("권역이 하나뿐인 데이터(부산권 발행 전)에서는 권역 고르기도 권역 꼬리표도 없다", async () => {
    const user = userEvent.setup();
    render(<HomeForm />);
    expect(screen.queryByRole("group", { name: "어디서 만나요?" })).not.toBeInTheDocument();
    await user.type(screen.getByRole("combobox", { name: "나의 출발역" }), "시청");
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).not.toContainEqual(expect.stringContaining("권"));
  });

  it("열리면 서버를 미리 깨운다(/api/healthz)", () => {
    render(<HomeForm />);
    expect(fetch).toHaveBeenCalledWith("/api/healthz", expect.objectContaining({ cache: "no-store" }));
  });

  it("두 역을 고르면 버튼이 켜지고 결과 링크로 간다(별칭 포함)", async () => {
    const user = userEvent.setup();
    render(<HomeForm />);
    const button = screen.getByRole("button", { name: "만날 역 찾기" });
    expect(button).toBeDisabled();

    await user.type(screen.getByRole("textbox", { name: "1번째 사람 이름(선택)" }), "민수");
    await user.type(screen.getByRole("combobox", { name: "민수의 출발역" }), "강남");
    await user.click(await screen.findByRole("option", { name: /^강남\s?2호선/ }));
    await user.type(screen.getByRole("combobox", { name: "친구1의 출발역" }), "ㅎㄷㅇㄱ");
    await user.click(await screen.findByRole("option", { name: /^홍대입구\s?2호선/ }));

    expect(button).toBeEnabled();
    await user.click(button);
    expect(push).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\/result\?v=2&o=[0-9a-z]{3}\.[0-9a-z]{3}&m=f&t=(weekday|saturday|holiday)-(morning|day|evening|night)&n=66-87IiY\.$/,
      ),
    );
  });

  it("언제 만나요?는 지금(서울) 시각으로 골라 두고, 고른 요일·시간대를 링크에 담는다", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-18T03:00:00Z") }); // 서울 수요일 12:00
    try {
      const user = userEvent.setup();
      render(<HomeForm />);
      expect(screen.getByRole("radio", { name: "평일" })).toBeChecked();
      expect(screen.getByRole("radio", { name: /^낮/ })).toBeChecked();
      expect(screen.getByText(/지금 시각으로 골라 뒀어요/)).toBeInTheDocument();

      await user.click(screen.getByRole("radio", { name: "토요일" }));
      await user.click(screen.getByRole("radio", { name: /^밤/ }));
      expect(screen.queryByText(/지금 시각으로 골라 뒀어요/)).toBeNull();
      await user.type(screen.getByRole("combobox", { name: "나의 출발역" }), "강남");
      await user.click(await screen.findByRole("option", { name: /^강남\s?2호선/ }));
      await user.type(screen.getByRole("combobox", { name: "친구1의 출발역" }), "잠실");
      await user.click(await screen.findByRole("option", { name: /^잠실\s?2호선/ }));
      await user.click(screen.getByRole("button", { name: "만날 역 찾기" }));
      expect(push).toHaveBeenCalledWith(expect.stringMatching(/&m=f&t=saturday-night$/));
    } finally {
      vi.useRealTimers();
    }
  });

  it("계산 범위 밖 역은 고를 수 없다고 알려 준다", async () => {
    const user = userEvent.setup();
    render(<HomeForm />);
    await user.type(screen.getByRole("combobox", { name: "나의 출발역" }), "임진강");
    const option = await screen.findByRole("option", {
      name: /임진강.*열차가 하루 몇 번뿐인 구간이라 계산하지 않아요/,
    });
    expect(option).toHaveAttribute("aria-disabled", "true");
  });

  it("최대 4명까지 늘리고, 3번째부터 뺄 수 있다", async () => {
    const user = userEvent.setup();
    render(<HomeForm />);
    await user.click(screen.getByRole("button", { name: /한 명 더/ }));
    await user.click(screen.getByRole("button", { name: /한 명 더/ }));
    expect(screen.getAllByRole("combobox")).toHaveLength(4);
    // 4명이 차면 '한 명 더'는 사라지고, 같은 자리에 눈에 덜 띄는 안내 버튼이 온다.
    expect(screen.queryByRole("button", { name: /한 명 더/ })).toBeNull();
    expect(screen.getByRole("button", { name: "4명까지 돼요 · 더 필요해요?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "친구2 빼기" }));
    expect(screen.getAllByRole("combobox")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: /더 필요해요/ })).toBeNull();
    expect(screen.getByRole("button", { name: /한 명 더/ })).toBeInTheDocument();
  });

  it("줄을 더하면 그 줄의 이름 칸으로 포커스가 간다(4번째 줄에서 버튼이 바뀌어도 포커스가 body로 떨어지지 않는다)", async () => {
    const user = userEvent.setup();
    render(<HomeForm />);
    await user.click(screen.getByRole("button", { name: /한 명 더/ }));
    expect(screen.getByRole("textbox", { name: "3번째 사람 이름(선택)" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: /한 명 더/ }));
    expect(screen.queryByRole("button", { name: /한 명 더/ })).toBeNull();
    expect(screen.getByRole("textbox", { name: "4번째 사람 이름(선택)" })).toHaveFocus();
    expect(document.body).not.toHaveFocus();
  });

  describe("인원 상한(4명) 수요 측정", () => {
    const fillToLimit = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(screen.getByRole("button", { name: /한 명 더/ }));
      await user.click(screen.getByRole("button", { name: /한 명 더/ }));
    };

    it("4명이 아니면 안내 버튼이 없고, 4명이 차기만 해서는 아무것도 보내지 않는다", async () => {
      const user = userEvent.setup();
      render(<HomeForm />);
      expect(screen.queryByRole("button", { name: /더 필요해요/ })).toBeNull();
      await fillToLimit(user);
      expect(screen.queryByText(/지금은 4명까지예요/)).toBeNull();
      expect(track).not.toHaveBeenCalled();
    });

    it("안내 버튼은 터치 영역 44px 이상이고, 누르면 안내만 보이며 people_limit_hit(home, 5)을 한 번 보낸다", async () => {
      const user = userEvent.setup();
      render(<HomeForm />);
      await fillToLimit(user);
      const button = screen.getByRole("button", { name: "4명까지 돼요 · 더 필요해요?" });
      expect(button).toHaveClass("min-h-11");
      // 닫히지 않는 안내라 펼침 상태를 알리지 않는다.
      expect(button).not.toHaveAttribute("aria-expanded");
      expect(button).not.toHaveAttribute("aria-controls");

      // 알림 영역은 눌러 보기 전에도 비어 있는 채로 있고, 같은 요소에 내용이 채워진다(채워진 채 새로 마운트되면 스크린리더가 읽지 않는다).
      const status = screen.getByRole("status");
      expect(status).toBeEmptyDOMElement();
      await user.click(button);
      expect(screen.getByRole("status")).toBe(status);
      expect(status).toHaveTextContent("지금은 4명까지예요. 더 필요하다는 의견을 모으고 있어요.");
      expect(screen.getAllByRole("combobox")).toHaveLength(4); // 줄은 늘지 않는다
      expect(push).not.toHaveBeenCalled();
      expect(track).toHaveBeenCalledTimes(1);
      expect(track).toHaveBeenCalledWith("people_limit_hit", { surface: "home", attempted: 5 });
    });

    it("줄을 빼면 안내가 사라지고, 다시 4명이 되어도 이전 안내가 남아 있지 않다(통계는 이미 보냈으니 다시 보내지 않는다)", async () => {
      const user = userEvent.setup();
      render(<HomeForm />);
      await fillToLimit(user);
      await user.click(screen.getByRole("button", { name: /더 필요해요/ }));
      expect(screen.getByRole("status")).toHaveTextContent(/지금은 4명까지예요/);
      await user.click(screen.getByRole("button", { name: "친구2 빼기" }));
      expect(screen.queryByText(/지금은 4명까지예요/)).toBeNull();
      await user.click(screen.getByRole("button", { name: /한 명 더/ }));
      expect(screen.queryByText(/지금은 4명까지예요/)).toBeNull();
      expect(track).toHaveBeenCalledTimes(1);
    });

    it("같은 화면에서 여러 번 눌러도(줄을 뺐다 다시 채운 뒤에도) 한 번만 보낸다", async () => {
      const user = userEvent.setup();
      render(<HomeForm />);
      await fillToLimit(user);
      await user.click(screen.getByRole("button", { name: /더 필요해요/ }));
      await user.click(screen.getByRole("button", { name: /더 필요해요/ }));
      await user.click(screen.getByRole("button", { name: "친구2 빼기" }));
      await user.click(screen.getByRole("button", { name: /한 명 더/ }));
      await user.click(screen.getByRole("button", { name: /더 필요해요/ }));
      expect(track).toHaveBeenCalledTimes(1);
    });
  });
});
