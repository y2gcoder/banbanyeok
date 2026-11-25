// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StationField } from "./station-field";

vi.mock("@/lib/stations/index.gen.json", async () => ({
  default: (await import("@/lib/stations/elsewhere.fixture")).ELSEWHERE_INDEX,
}));

const capital = { region: "capital", slot: null } as const;
const options = () => screen.getAllByRole("option").map((o) => o.querySelector("span span span")?.textContent);

describe("역 자동완성: 다른 권역에만 정확히 같은 이름이 있을 때", () => {
  it("고른 권역의 후보와 함께 다른 권역 안내와 바꾸기를 보인다", async () => {
    const user = userEvent.setup();
    const switchRegion = vi.fn();
    render(<StationField id="s" value={null} onChange={vi.fn()} scope={capital} onSwitchRegion={switchRegion} />);
    await user.type(screen.getByRole("combobox"), "기장");
    expect(options()).toEqual(["문학경기장", "월드컵경기장"]);
    expect(screen.getByText("부산권에 기장이 있어요")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "부산권으로 바꾸기" }));
    expect(switchRegion).toHaveBeenCalledWith("busan");
  });

  it("고른 권역에도 같은 이름이 있으면 '에도'로 알린다", async () => {
    const user = userEvent.setup();
    render(<StationField id="s" value={null} onChange={vi.fn()} scope={capital} onSwitchRegion={vi.fn()} />);
    await user.type(screen.getByRole("combobox"), "시청");
    expect(options()).toEqual(["시청"]);
    expect(screen.getByText("부산권에도 시청이 있어요")).toBeInTheDocument();
  });

  it("방 참여(바꾸기 없음)에서는 이 방의 권역만 고를 수 있다고 알린다", async () => {
    const user = userEvent.setup();
    render(<StationField id="s" value={null} onChange={vi.fn()} scope={capital} />);
    await user.type(screen.getByRole("combobox"), "기장");
    expect(screen.getByText("부산권에 기장이 있어요")).toBeInTheDocument();
    expect(screen.getByText("이 방에서는 수도권 역만 고를 수 있어요.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /바꾸기/ })).not.toBeInTheDocument();
  });

  it("다른 권역이 부분 일치뿐이면 안내 없이 후보만 보인다", async () => {
    const user = userEvent.setup();
    render(<StationField id="s" value={null} onChange={vi.fn()} scope={capital} onSwitchRegion={vi.fn()} />);
    await user.type(screen.getByRole("combobox"), "경기");
    expect(options()).toEqual(["문학경기장", "월드컵경기장"]);
    expect(screen.queryByText(/있어요$/)).not.toBeInTheDocument();
  });
});
