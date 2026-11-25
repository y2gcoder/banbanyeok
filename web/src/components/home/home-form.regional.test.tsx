// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RegionProvider } from "@/components/common/region-choice";
import { SupportedLinesDisclosure } from "@/components/common/supported-lines";
import { HomeForm } from "./home-form";

/** 계약 픽스처(두 권역)의 인덱스: 수도권 서울가·교대, 부산권 교대·부산가·부산나(동해선만, 토요일 출발 불가). */
vi.mock("@/lib/stations/index.gen.json", async () => ({
  default: (await import("@/lib/stations/regional.fixture.gen.json")).default,
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

function HomePage() {
  return (
    <RegionProvider>
      <SupportedLinesDisclosure />
      <HomeForm />
    </RegionProvider>
  );
}

const pick = async (user: ReturnType<typeof userEvent.setup>, field: string, query: string, option: RegExp) => {
  await user.type(screen.getByRole("combobox", { name: field }), query);
  await user.click(await screen.findByRole("option", { name: option }));
};

describe("입력 화면: 권역이 둘인 데이터", () => {
  beforeEach(() => {
    push.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("ok"))),
    );
    window.localStorage.clear();
  });

  it("어디서 만나요?는 수도권이 기본이고, 검색은 그 권역 안에서만 한다", async () => {
    const user = userEvent.setup();
    render(<HomePage />);
    expect(screen.getByRole("group", { name: "어디서 만나요?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "수도권" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "수도권 전철 1개 노선을 계산해요" })).toBeInTheDocument();
    await user.type(screen.getByRole("combobox", { name: "나의 출발역" }), "교대");
    const options = await screen.findAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).not.toHaveTextContent("권");
  });

  it("권역 밖의 역을 치면 그 권역에 있다고 알리고, 바꾸기를 누르면 그 권역에서 다시 찾는다(고른 역이 없으면 묻지 않는다)", async () => {
    const user = userEvent.setup();
    render(<HomePage />);
    await user.type(screen.getByRole("combobox", { name: "나의 출발역" }), "부산가");
    expect(await screen.findByText("부산권에 부산가가 있어요")).toBeInTheDocument();
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "부산권으로 바꾸기" }));
    // 친 글자는 그대로라 목록이 바로 부산권 결과로 바뀐다.
    await user.click(await screen.findByRole("option", { name: /^부산가/ }));
    expect(screen.getByRole("button", { name: "부산권" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "부산권 전철 2개 노선을 계산해요" })).toBeInTheDocument();
  });

  it("고른 출발역이 있으면 지우기 전에 한 번 묻고, 취소하면 그대로 둔다", async () => {
    const user = userEvent.setup();
    render(<HomePage />);
    await pick(user, "나의 출발역", "서울가", /^서울가/);
    await user.click(screen.getByRole("button", { name: "부산권" }));
    expect(screen.getByText("고른 출발역을 지우고 부산권으로 바꿀까요?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.getByRole("combobox", { name: "나의 출발역" })).toHaveValue("서울가");
    expect(screen.getByRole("button", { name: "수도권" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "부산권" }));
    await user.click(screen.getByRole("button", { name: "바꾸기" }));
    expect(screen.getByRole("button", { name: "부산권" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("combobox", { name: "나의 출발역" })).toHaveValue("");
  });

  it("고른 요일에 출발할 수 없는 역은 이유와 함께 고를 수 없다", async () => {
    const user = userEvent.setup();
    render(<HomePage />);
    await user.click(screen.getByRole("button", { name: "부산권" }));
    await user.click(screen.getByRole("radio", { name: "토요일" }));
    await user.type(screen.getByRole("combobox", { name: "나의 출발역" }), "부산나");
    const option = await screen.findByRole("option", { name: /^부산나/ });
    expect(option).toHaveAttribute("aria-disabled", "true");
    expect(option).toHaveTextContent("토요일 동해선 시간표를 아직 확인하지 못해 고를 수 없어요");
  });

  it("고른 뒤 요일을 바꿔 출발할 수 없게 되면 칸 아래에 이유를 두고 찾기를 막는다", async () => {
    const user = userEvent.setup();
    render(<HomePage />);
    await user.click(screen.getByRole("button", { name: "부산권" }));
    await user.click(screen.getByRole("radio", { name: "평일" }));
    await pick(user, "나의 출발역", "부산나", /^부산나/);
    await pick(user, "친구1의 출발역", "부산가", /^부산가/);
    await user.click(screen.getByRole("radio", { name: "토요일" }));
    expect(screen.getByText("토요일 동해선 시간표를 아직 확인하지 못해 고를 수 없어요")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "만날 역 찾기" }));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("출발역이나 요일·시간대를 바꿔 주세요");
  });

  it("미리 채운 역(SEO 페이지 링크)의 권역으로 맞춘다", async () => {
    window.history.replaceState(null, "", "/?o=004.003");
    try {
      render(<HomePage />);
      expect(await screen.findByDisplayValue("부산가")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "부산권" })).toHaveAttribute("aria-pressed", "true");
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });
});
