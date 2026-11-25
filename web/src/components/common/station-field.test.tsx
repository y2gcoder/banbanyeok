// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Station, searchStations } from "@/lib/stations";
import { StationField } from "./station-field";

const station = (name: string): Station => {
  const found = searchStations(name).find((s) => s.name === name && s.supported);
  if (!found) throw new Error(`${name} 역이 없다`);
  return found;
};

/** 고른 역을 밖에서 들고 있는 입력 칸(입력 화면의 한 줄과 같다). */
function Harness({ initial = null }: { initial?: Station | null }) {
  const [value, setValue] = useState<Station | null>(initial);
  return (
    <>
      <StationField id="s" value={value} onChange={setValue} />
      <output data-testid="picked">{value ? `${value.name}/${value.code}` : "없음"}</output>
    </>
  );
}

const optionNames = () => screen.getAllByRole("option").map((o) => o.querySelector("span span span")?.textContent);
const highlighted = () => screen.getAllByRole("option").find((o) => o.hasAttribute("data-highlighted"));

describe("역 자동완성: 키보드 선택", () => {
  it("정확 일치가 첫 후보이고, 하이라이트·aria-activedescendant·Enter 선택이 모두 그 항목이다", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole("combobox");
    await user.type(input, "강남");
    expect(optionNames()).toEqual(["강남", "강남대", "강남구청"]);
    expect(highlighted()?.id).toBe(screen.getAllByRole("option")[0]?.id);
    expect(input).toHaveAttribute("aria-activedescendant", screen.getAllByRole("option")[0]?.id);
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("picked")).toHaveTextContent(`강남/${station("강남").code}`);
  });

  it("ArrowDown은 한 칸 아래로 옮기고, 하이라이트된 항목을 Enter가 고른다", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole("combobox");
    await user.type(input, "강남");
    await user.keyboard("{ArrowDown}");
    const second = screen.getAllByRole("option")[1];
    expect(highlighted()?.id).toBe(second?.id);
    expect(input).toHaveAttribute("aria-activedescendant", second?.id);
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("picked")).toHaveTextContent(`강남대/${station("강남대").code}`);
  });

  it("이미 다른 역을 고른 칸에 새로 쳐도 고른 역이 목록 맨 앞에 끼어들지 않는다", async () => {
    const user = userEvent.setup();
    render(<Harness initial={station("혜화")} />);
    const input = screen.getByRole("combobox");
    expect(input).toHaveValue("혜화");
    await user.tripleClick(input);
    await user.keyboard("강남");
    expect(optionNames()[0]).toBe("강남");
    expect(input).toHaveAttribute("aria-activedescendant", screen.getAllByRole("option")[0]?.id);
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("picked")).toHaveTextContent(`강남/${station("강남").code}`);
  });
});

describe("역 자동완성: 한글 조합(#177)", () => {
  it("조합 중인 글자까지 찾고, 조합을 확정해도 목록이 바뀌지 않는다", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole("combobox");
    await user.type(input, "서울");
    expect(optionNames()).toContain("서울숲");
    // "대"를 조합하는 중: 입력 칸에 보이는 "서울대"로 찾는다(Base UI는 조합 중 inputValue를 넘기지 않는다).
    fireEvent.compositionStart(input, { data: "" });
    fireEvent.input(input, { target: { value: "서울대" } });
    expect(optionNames()).toEqual(["서울대입구", "서울대벤처타운"]);
    fireEvent.compositionEnd(input, { data: "대" });
    expect(input).toHaveValue("서울대");
    expect(optionNames()).toEqual(["서울대입구", "서울대벤처타운"]);
  });
});

describe("역 자동완성: 계산 범위 안내(#170)", () => {
  it("결과가 없으면 오타 안내와 함께 수도권 전철 노선만 계산한다고 알린다", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByRole("combobox"), "서면");
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("찾는 역이 없어요");
    expect(status).toHaveTextContent(/아직 수도권 전철 \d+개 노선만 계산해요\. 이름이 맞는지도 확인해 주세요\./);
  });

  it("계산하지 않는 역은 표의 이유를 붙이고 고를 수 없다", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByRole("combobox"), "용유");
    const option = await screen.findByRole("option", { name: /용유.*관광용 열차가 띄엄띄엄 다녀서 계산하지 않아요/ });
    expect(option).toHaveAttribute("aria-disabled", "true");
  });
});

/** 목록 아래에 있던 칸 하나(방 화면의 '출발역 이름 숨기기'와 같다). */
function WithCheckbox() {
  const [checked, setChecked] = useState(false);
  return (
    <>
      <Harness />
      <input type="checkbox" aria-label="아래 칸" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
    </>
  );
}

/**
 * jsdom은 배치를 하지 않으므로 목록 자리를 (0,200)~(300,300)으로 둔다. 다른 요소는 크기 0. user-event는 (0,0)에서 누르므로
 * 입력 칸을 누르는 것은 목록 밖 누름이다.
 */
function stubListArea() {
  return vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.dataset.slot !== "combobox-content") return DOMRect.fromRect({ x: 0, y: 0, width: 0, height: 0 });
    return DOMRect.fromRect({ x: 0, y: 200, width: 300, height: 100 });
  });
}

/** 아래 칸을 (x, y)에서 누른다: 누르기 시작(mousedown)부터 click까지. */
function pressAt(element: Element, x: number, y: number) {
  fireEvent.mouseDown(element, { clientX: x, clientY: y, detail: 1 });
  fireEvent.mouseUp(element, { clientX: x, clientY: y, detail: 1 });
  fireEvent.click(element, { clientX: x, clientY: y, detail: 1 });
}

describe("역 자동완성: 고른 뒤 같은 자리의 두 번째 누름(#177)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** 목록 자리 (150, 250)의 첫 항목을 마우스로 눌러 고른다. */
  async function pickByMouse() {
    stubListArea();
    const user = userEvent.setup();
    render(<WithCheckbox />);
    await user.type(screen.getByRole("combobox"), "강남");
    fireEvent.click(screen.getAllByRole("option")[0] as HTMLElement, { clientX: 150, clientY: 250, detail: 1 });
    expect(screen.getByTestId("picked")).toHaveTextContent(`강남/${station("강남").code}`);
    return screen.getByRole("checkbox", { name: "아래 칸" });
  }

  it("고른 자리를 바로 다시 누르면(누름 횟수와 무관) 아래 칸에 닿지 않는다", async () => {
    const below = await pickByMouse();
    pressAt(below, 155, 255);
    expect(below).not.toBeChecked();
  });

  it("목록 자리라도 고른 자리에서 먼 곳을 누르면 그대로 닿는다", async () => {
    const below = await pickByMouse();
    pressAt(below, 280, 290);
    expect(below).toBeChecked();
  });

  it("다른 곳을 누르면 바로 풀려서, 그 뒤로는 고른 자리도 막지 않는다", async () => {
    const below = await pickByMouse();
    pressAt(below, 150, 500);
    expect(below).toBeChecked();
    pressAt(below, 150, 250);
    expect(below).not.toBeChecked();
  });

  it("고른 뒤 잠깐이 지나면 고른 자리도 다시 누를 수 있다", async () => {
    const below = await pickByMouse();
    await act(() => new Promise((resolve) => setTimeout(resolve, 600)));
    pressAt(below, 150, 250);
    expect(below).toBeChecked();
  });

  it("키보드로 고르면 그 자리의 누름도 막지 않는다", async () => {
    stubListArea();
    const user = userEvent.setup();
    render(<WithCheckbox />);
    await user.type(screen.getByRole("combobox"), "강남");
    await user.keyboard("{Enter}");
    const below = screen.getByRole("checkbox", { name: "아래 칸" });
    pressAt(below, 150, 250);
    expect(below).toBeChecked();
  });
});
