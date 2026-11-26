// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { searchStations } from "@/lib/stations";
import { JoinForm } from "./join-form";

/** 계약 픽스처(두 권역)의 인덱스: 수도권 서울가·교대, 부산권 교대·부산가·부산나(동해선만, 토요일 출발 불가). */
vi.mock("@/lib/stations/index.gen.json", async () => ({
  default: (await import("@/lib/stations/regional.fixture.gen.json")).default,
}));

const SATURDAY_BUSAN = { region: "busan", slot: "saturday-evening" } as const;
const empty = { nickname: "", station: null, hidden: false };

describe("방 참여: 방의 권역과 구분을 따른다", () => {
  beforeEach(() => window.localStorage.clear());

  it("권역 고르기는 없고, 다른 권역의 역을 치면 이 방에서 고를 수 있는 권역을 알린다", async () => {
    const user = userEvent.setup();
    render(
      <JoinForm
        mode="join"
        initial={empty}
        personIndex={1}
        pending={false}
        error={null}
        onSubmit={vi.fn()}
        scope={SATURDAY_BUSAN}
      />,
    );
    expect(screen.queryByRole("group", { name: "어디서 만나요?" })).not.toBeInTheDocument();
    await user.type(screen.getByRole("combobox", { name: "내 출발역" }), "서울가");
    expect(await screen.findByText("수도권에 서울가가 있어요")).toBeInTheDocument();
    expect(screen.getByText("이 방에서는 부산권 역만 고를 수 있어요.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /바꾸기/ })).not.toBeInTheDocument();
  });

  it("방의 구분에 출발할 수 없는 역은 이유와 함께 고를 수 없다", async () => {
    const user = userEvent.setup();
    render(
      <JoinForm
        mode="join"
        initial={empty}
        personIndex={1}
        pending={false}
        error={null}
        onSubmit={vi.fn()}
        scope={SATURDAY_BUSAN}
      />,
    );
    await user.type(screen.getByRole("combobox", { name: "내 출발역" }), "부산");
    const blocked = await screen.findByRole("option", { name: /^부산나/ });
    expect(blocked).toHaveAttribute("aria-disabled", "true");
    expect(blocked).toHaveTextContent("토요일 동해선 시간표를 아직 확인하지 못해 고를 수 없어요");
    expect(screen.getByRole("option", { name: /^부산가/ })).not.toHaveAttribute("aria-disabled", "true");
  });

  it("기억해 둔 내 역이 이 방에서 고를 수 없으면 비워 둔다", () => {
    const busanNa = searchStations("부산나").find((s) => s.name === "부산나");
    if (!busanNa) throw new Error("부산나 없음");
    render(
      <JoinForm
        mode="join"
        initial={{ ...empty, station: busanNa }}
        personIndex={1}
        pending={false}
        error={null}
        onSubmit={vi.fn()}
        scope={SATURDAY_BUSAN}
      />,
    );
    expect(screen.getByRole("combobox", { name: "내 출발역" })).toHaveValue("");
    expect(screen.getByRole("button", { name: "참여하기" })).toBeDisabled();
  });

  it("방의 권역을 모르면 모든 권역에서 찾고, 같은 이름에만 권역을 붙인다", async () => {
    const user = userEvent.setup();
    render(
      <JoinForm
        mode="join"
        initial={empty}
        personIndex={1}
        pending={false}
        error={null}
        onSubmit={vi.fn()}
        scope={{ region: null, slot: null }}
      />,
    );
    await user.type(screen.getByRole("combobox", { name: "내 출발역" }), "교대");
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining("수도권"),
      expect.stringContaining("부산권"),
    ]);
  });
});
