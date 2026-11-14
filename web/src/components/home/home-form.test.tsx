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
      expect.stringMatching(/^\/result\?v=1&o=[0-9a-z]{3}\.[0-9a-z]{3}&m=f&n=66-87IiY\.$/),
    );
  });

  it("수도권 밖 역은 고를 수 없다고 알려 준다", async () => {
    const user = userEvent.setup();
    render(<HomeForm />);
    await user.type(screen.getByRole("combobox", { name: "나의 출발역" }), "서면");
    const option = await screen.findByRole("option", { name: /서면.*아직 수도권 지하철역만 계산할 수 있어요/ });
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
