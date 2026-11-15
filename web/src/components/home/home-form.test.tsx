// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HomeForm } from "./home-form";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

describe("입력 화면", () => {
  beforeEach(() => {
    push.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("ok"))),
    );
    window.localStorage.clear();
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
    const option = await screen.findByRole("option", { name: /임진강.*이 노선의 역은 아직 계산하지 못해요/ });
    expect(option).toHaveAttribute("aria-disabled", "true");
  });

  it("최대 4명까지 늘리고, 3번째부터 뺄 수 있다", async () => {
    const user = userEvent.setup();
    render(<HomeForm />);
    await user.click(screen.getByRole("button", { name: /한 명 더/ }));
    await user.click(screen.getByRole("button", { name: /한 명 더/ }));
    expect(screen.getAllByRole("combobox")).toHaveLength(4);
    expect(screen.queryByRole("button", { name: /한 명 더/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "친구2 빼기" }));
    expect(screen.getAllByRole("combobox")).toHaveLength(3);
  });
});
