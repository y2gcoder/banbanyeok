// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { searchStations } from "@/lib/stations";
import { ConfirmAction } from "./confirm-action";
import { JoinForm } from "./join-form";

const station = searchStations("강남").find((s) => s.name === "강남" && s.supported);
if (!station) throw new Error("테스트 역이 없다");

describe("참여 폼", () => {
  beforeEach(() => window.localStorage.clear());

  it("역을 고르기 전에는 참여할 수 없고, 고르면 이름(선택)·숨김과 함께 입력을 넘긴다", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <JoinForm
        mode="join"
        initial={{ nickname: "", station: null, hidden: false }}
        personIndex={1}
        pending={false}
        error={null}
        onSubmit={onSubmit}
      />,
    );
    const button = screen.getByRole("button", { name: "참여하기" });
    expect(button).toBeDisabled();
    // 숨기기는 역 이름만 가리고 시간은 보인다는 고지가 그 자리에 있다.
    expect(screen.getByText(/소요시간과 환승 횟수는 모두에게 보이니/)).toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "내 이름(선택)" }), "  지연 ");
    await user.type(screen.getByRole("combobox", { name: "내 출발역" }), "강남");
    await user.click(await screen.findByRole("option", { name: /^강남\s?2호선/ }));
    await user.click(screen.getByRole("checkbox", { name: /출발역 이름 숨기기/ }));
    expect(button).toBeEnabled();
    await user.click(button);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({ originCode: station.code, hidden: true, nickname: "지연" });
  });

  it("21자 이름은 보내지 않고 안내한다", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <JoinForm
        mode="edit"
        initial={{ nickname: "", station, hidden: false }}
        personIndex={0}
        pending={false}
        error={null}
        onSubmit={onSubmit}
      />,
    );
    await user.type(screen.getByRole("textbox", { name: "내 이름(선택)" }), "가".repeat(21));
    await user.click(screen.getByRole("button", { name: "저장하기" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("20자까지");
  });

  it("보내는 중이면 버튼이 잠기고 서버 오류 문구를 보여 준다", () => {
    render(
      <JoinForm
        mode="join"
        initial={{ nickname: "", station, hidden: false }}
        personIndex={0}
        pending={true}
        error="방이 가득 찼어요."
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "참여하는 중…" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("방이 가득 찼어요.");
  });
});

describe("되돌릴 수 없는 동작 확인", () => {
  it("한 번 더 눌러야 실행되고, 취소하면 실행되지 않는다", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmAction label="삭제" target="내 항목" question="지울까요?" confirmLabel="지우기" onConfirm={onConfirm} />,
    );
    await user.click(screen.getByRole("button", { name: "삭제 내 항목" }));
    expect(onConfirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.getByRole("button", { name: "삭제 내 항목" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "삭제 내 항목" }));
    await user.click(screen.getByRole("button", { name: "지우기" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
