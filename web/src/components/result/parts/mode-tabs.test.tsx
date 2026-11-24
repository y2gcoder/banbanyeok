// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ModeTabs } from "./mode-tabs";

const people = [
  { index: 0, name: "민지" },
  { index: 1, name: "지훈" },
];

describe("모드 탭", () => {
  it("배려 탭을 누르면 기본 대상(가장 오래 걸리는 사람)으로 바꾼다", async () => {
    const onChange = vi.fn();
    render(
      <ModeTabs
        mode="fair"
        favorIndex={null}
        people={people}
        onChange={onChange}
        defaultFavorIndex={1}
        label="추천 기준"
        panelId="p"
      />,
    );
    expect(screen.getByRole("tab", { name: "공평하게" })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(screen.getByRole("tab", { name: "누구 쪽으로" }));
    expect(onChange).toHaveBeenCalledWith("favor", 1);
  });

  it("배려 모드에서도 탭 이름은 고정이고(폰 폭에서 잘리지 않게) 아래 알약으로 대상을 바꾼다", async () => {
    const onChange = vi.fn();
    render(
      <ModeTabs
        mode="favor"
        favorIndex={1}
        people={people}
        onChange={onChange}
        defaultFavorIndex={1}
        label="추천 기준"
        panelId="p"
      />,
    );
    expect(screen.getByRole("tab", { name: "누구 쪽으로" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("tab", { name: /지훈/ })).toBeNull();
    expect(screen.getByRole("button", { name: "지훈" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "민지" }));
    expect(onChange).toHaveBeenCalledWith("favor", 0);
  });

  it("고를 수 있는 사람이 없으면 배려 탭을 두지 않는다(모두 출발역을 숨긴 방, #162)", () => {
    render(
      <ModeTabs
        mode="fair"
        favorIndex={null}
        people={[]}
        onChange={vi.fn()}
        defaultFavorIndex={0}
        label="추천 기준"
        panelId="p"
      />,
    );
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["공평하게", "빨리 만나기"]);
  });

  it("키보드 화살표로 탭을 옮긴다", async () => {
    const onChange = vi.fn();
    render(
      <ModeTabs
        mode="fair"
        favorIndex={null}
        people={people}
        onChange={onChange}
        defaultFavorIndex={1}
        label="추천 기준"
        panelId="p"
      />,
    );
    screen.getByRole("tab", { name: "공평하게" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "빨리 만나기" })).toHaveFocus();
  });
});
