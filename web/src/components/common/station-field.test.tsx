// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Station, searchStations } from "@/lib/stations";
import { StationField } from "./station-field";

/** 권역을 켜기 전(수도권만) 색인으로 본다. 커밋된 색인이 부산권을 켜도 이 파일의 뜻은 그대로다(capital.fixture.gen.json, pnpm gen:stations). */
vi.mock("@/lib/stations/index.gen.json", async () => ({
  default: (await import("@/lib/stations/capital.fixture.gen.json")).default,
}));

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

describe("역 자동완성: 조합을 확정하기 전에 고르기(#177)", () => {
  /** "서울" 뒤 "대"를 조합하는 중에 서울대입구를 마우스로 고른다(확정은 아직). */
  async function pickWhileComposing() {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole("combobox");
    await user.type(input, "서울");
    fireEvent.compositionStart(input, { data: "" });
    fireEvent.input(input, { target: { value: "서울대" } });
    fireEvent.click(screen.getAllByRole("option")[0] as HTMLElement, { detail: 1 });
    expect(screen.getByTestId("picked")).toHaveTextContent(`서울대입구/${station("서울대입구").code}`);
    return { user, input };
  }

  it("그 조합이 늦게 확정되면(같은 글자든 다른 글자든) 입력 칸은 고른 역 이름이다", async () => {
    const { input } = await pickWhileComposing();
    fireEvent.input(input, { target: { value: "서울데" } }); // 확정 전에 조합이 바뀌었다
    fireEvent.compositionEnd(input, { data: "데" });
    expect(input).toHaveValue("서울대입구");
  });

  it("보정은 그 조합 한 번뿐이다: 그 뒤 전체를 지우고 새로 '서울대'를 치면 그대로 '서울대'다", async () => {
    const { user, input } = await pickWhileComposing();
    fireEvent.compositionEnd(input, { data: "대" });
    expect(input).toHaveValue("서울대입구");
    // 전체를 골라 한 번에 '서울대'로 바꾼다(붙여넣기·IME 한 번 확정과 같다).
    (input as HTMLInputElement).select();
    fireEvent.input(input, { target: { value: "서울대" } });
    expect(input).toHaveValue("서울대");
    await user.clear(input);
    await user.type(input, "서울대");
    expect(input).toHaveValue("서울대");
    // 새 조합으로 쳐도 그대로다.
    await user.clear(input);
    await user.type(input, "서울");
    fireEvent.compositionStart(input, { data: "" });
    fireEvent.input(input, { target: { value: "서울대" } });
    fireEvent.compositionEnd(input, { data: "대" });
    expect(input).toHaveValue("서울대");
  });
});

describe("역 자동완성: 조합 중 Enter(ime-safe-enter-submit)", () => {
  /** "서울" 뒤 "대"를 조합하는 중(첫 항목 서울대입구가 강조됨). */
  async function composingSeoulDae() {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole("combobox");
    await user.type(input, "서울");
    fireEvent.compositionStart(input, { data: "" });
    fireEvent.input(input, { target: { value: "서울대" } });
    expect(optionNames()[0]).toBe("서울대입구");
    return input;
  }

  it("조합을 확정하는 Enter(isComposing, keyCode 229)는 항목을 고르지 않는다", async () => {
    const input = await composingSeoulDae();
    fireEvent.keyDown(input, { key: "Enter", code: "Enter", keyCode: 229, which: 229, isComposing: true });
    fireEvent.compositionEnd(input, { data: "대" });
    expect(screen.getByTestId("picked")).toHaveTextContent("없음");
    expect(input).toHaveValue("서울대");
    expect(screen.getAllByRole("option").length).toBeGreaterThan(0);
  });

  it("Safari 순서(compositionend가 먼저 와서 isComposing false, keyCode 229)여도 고르지 않는다", async () => {
    const input = await composingSeoulDae();
    fireEvent.compositionEnd(input, { data: "대" });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter", keyCode: 229, which: 229, isComposing: false });
    expect(screen.getByTestId("picked")).toHaveTextContent("없음");
    expect(input).toHaveValue("서울대");
  });

  it("확정한 뒤의 Enter(keyCode 13)는 강조된 항목을 고른다", async () => {
    const input = await composingSeoulDae();
    fireEvent.compositionEnd(input, { data: "대" });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter", keyCode: 13, which: 13 });
    expect(screen.getByTestId("picked")).toHaveTextContent(`서울대입구/${station("서울대입구").code}`);
  });
});

describe("역 자동완성: 조합 중 결과 없음(#177)", () => {
  it("조합 중에는 '없음' 안내를 미루고, 확정한 뒤에도 없으면 알린다", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole("combobox");
    await user.type(input, "서울");
    fireEvent.compositionStart(input, { data: "" });
    fireEvent.input(input, { target: { value: "서울퓨" } });
    expect(screen.queryByRole("option")).toBeNull();
    expect(screen.queryByText("찾는 역이 없어요", { exact: false })).toBeNull();
    fireEvent.compositionEnd(input, { data: "퓨" });
    expect(await screen.findByRole("status")).toHaveTextContent("찾는 역이 없어요");
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

/** 마우스로 (x, y)를 누른다. `detail`은 운영체제가 센 연속 클릭 수(더블클릭의 두 번째는 2). */
function clickAt(element: Element, x: number, y: number, detail: number) {
  fireEvent.mouseDown(element, { clientX: x, clientY: y, detail });
  fireEvent.mouseUp(element, { clientX: x, clientY: y, detail });
  fireEvent.click(element, { clientX: x, clientY: y, detail });
}

/** 손가락으로 (x, y)를 탭한다(iOS WebKit처럼 click detail은 늘 1). */
function tapAt(element: Element, x: number, y: number, pointerId: number) {
  const at = { clientX: x, clientY: y, pointerId, pointerType: "touch", isPrimary: true };
  fireEvent.pointerDown(element, at);
  fireEvent.pointerUp(element, at);
  fireEvent.mouseDown(element, { clientX: x, clientY: y, detail: 1 });
  fireEvent.mouseUp(element, { clientX: x, clientY: y, detail: 1 });
  fireEvent.click(element, { clientX: x, clientY: y, detail: 1 });
}

describe("역 자동완성: 고른 뒤 같은 자리의 두 번째 누름(#177)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** 목록 자리 (150, 250)의 첫 항목을 마우스나 손가락으로 눌러 고른다. */
  async function pick(by: "mouse" | "touch") {
    stubListArea();
    const user = userEvent.setup();
    render(<WithCheckbox />);
    await user.type(screen.getByRole("combobox"), "강남");
    const option = screen.getAllByRole("option")[0] as HTMLElement;
    if (by === "touch")
      fireEvent.pointerDown(option, { pointerType: "touch", pointerId: 7, clientX: 150, clientY: 250 });
    fireEvent.click(option, { clientX: 150, clientY: 250, detail: 1 });
    expect(screen.getByTestId("picked")).toHaveTextContent(`강남/${station("강남").code}`);
    return screen.getByRole("checkbox", { name: "아래 칸" });
  }

  it("마우스: 더블클릭의 두 번째 누름(detail 2)은 아래 칸에 닿지 않는다", async () => {
    const below = await pick("mouse");
    clickAt(below, 152, 252, 2);
    expect(below).not.toBeChecked();
  });

  it("마우스: 따로 누른 클릭(detail 1)은 고른 자리 바로 옆이어도 닿는다", async () => {
    const below = await pick("mouse");
    clickAt(below, 168, 250, 1);
    expect(below).toBeChecked();
  });

  it("마우스: 두 번째 누름 도중 키보드 Space(detail 0 click)는 막지 않고, 그 마우스 click만 막는다", async () => {
    const below = await pick("mouse");
    fireEvent.mouseDown(below, { clientX: 152, clientY: 252, detail: 2 });
    fireEvent.click(below, { detail: 0 }); // 포커스된 체크박스에서 Space
    expect(below).toBeChecked();
    fireEvent.mouseUp(below, { clientX: 152, clientY: 252, detail: 2 });
    fireEvent.click(below, { clientX: 152, clientY: 252, detail: 2 });
    expect(below).toBeChecked();
  });

  it("손가락: 고른 자리를 바로 다시 탭하면(detail 1이어도) 닿지 않고, 먼 곳·잠깐 뒤의 탭은 닿는다", async () => {
    const below = await pick("touch");
    tapAt(below, 155, 255, 8);
    expect(below).not.toBeChecked();
    tapAt(below, 280, 290, 9);
    expect(below).toBeChecked();
  });

  it("손가락: 고른 뒤 잠깐이 지나면 고른 자리도 다시 탭할 수 있다", async () => {
    const below = await pick("touch");
    await act(() => new Promise((resolve) => setTimeout(resolve, 600)));
    tapAt(below, 150, 250, 8);
    expect(below).toBeChecked();
  });

  it("손가락: 두 번째 탭 도중 보조기기의 직접 활성화(detail 0 click)는 막지 않는다", async () => {
    const below = await pick("touch");
    fireEvent.pointerDown(below, { pointerType: "touch", pointerId: 8, clientX: 150, clientY: 250 });
    fireEvent.click(below, { detail: 0 });
    expect(below).toBeChecked();
    // 그 탭이 끝난다(손을 뗀 뒤의 click은 삼킨다).
    fireEvent.pointerUp(below, { pointerType: "touch", pointerId: 8, clientX: 150, clientY: 250 });
    fireEvent.click(below, { clientX: 150, clientY: 250, detail: 1 });
    expect(below).toBeChecked();
  });

  it("손가락을 누른 채 마우스로 다른 곳을 누르면 그 마우스 클릭은 닿고, 손가락을 뗀 뒤의 click만 막는다", async () => {
    const below = await pick("touch");
    fireEvent.pointerDown(below, { pointerType: "touch", pointerId: 3, clientX: 150, clientY: 250 });
    const mouse = { pointerType: "mouse", pointerId: 1, clientX: 280, clientY: 290 };
    fireEvent.pointerDown(below, mouse);
    fireEvent.pointerUp(below, mouse);
    fireEvent.mouseDown(below, { clientX: 280, clientY: 290, detail: 1 });
    fireEvent.mouseUp(below, { clientX: 280, clientY: 290, detail: 1 });
    fireEvent.click(below, { clientX: 280, clientY: 290, detail: 1 });
    expect(below).toBeChecked();
    fireEvent.pointerUp(below, { pointerType: "touch", pointerId: 3, clientX: 150, clientY: 250 });
    fireEvent.click(below, { clientX: 150, clientY: 250, detail: 1 });
    expect(below).toBeChecked();
  });

  it("키보드로 고르면 그 자리의 누름도 막지 않는다", async () => {
    stubListArea();
    const user = userEvent.setup();
    render(<WithCheckbox />);
    await user.type(screen.getByRole("combobox"), "강남");
    await user.keyboard("{Enter}");
    const below = screen.getByRole("checkbox", { name: "아래 칸" });
    clickAt(below, 150, 250, 2);
    expect(below).toBeChecked();
  });
});
