// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { onScreenKeyboardOpen, useOnScreenKeyboardOpen } from "./use-on-screen-keyboard";

/** jsdom에는 visualViewport가 없다. 높이·배율을 바꿀 수 있는 가짜를 단다. */
class FakeViewport extends EventTarget {
  height = 800;
  scale = 1;
  set(height: number, scale = 1) {
    this.height = height;
    this.scale = scale;
    this.dispatchEvent(new Event("resize"));
  }
}

let vv: FakeViewport;
beforeEach(() => {
  vv = new FakeViewport();
  Object.defineProperty(window, "visualViewport", { configurable: true, value: vv });
  Object.defineProperty(document.documentElement, "clientHeight", { configurable: true, value: 800 });
  document.body.innerHTML = "";
});
afterEach(() => {
  Object.defineProperty(window, "visualViewport", { configurable: true, value: undefined });
});

function Probe() {
  return <p data-testid="probe">{useOnScreenKeyboardOpen() ? "열림" : "닫힘"}</p>;
}

describe("화면 키보드 감지", () => {
  it("글자 칸에 초점이 있고 보이는 영역이 레이아웃보다 150px 넘게 줄면 열린 것이다", () => {
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    expect(onScreenKeyboardOpen()).toBe(false); // 아직 키보드가 올라오지 않았다
    vv.set(420);
    expect(onScreenKeyboardOpen()).toBe(true);
  });

  it("초점이 글자 칸이 아니면(체크박스·버튼) 영역이 줄어도 닫힌 것이다", () => {
    const box = document.createElement("input");
    box.type = "checkbox";
    document.body.append(box);
    box.focus();
    vv.set(420);
    expect(onScreenKeyboardOpen()).toBe(false);
  });

  it("손가락으로 확대한 것(배율)은 키보드가 아니다", () => {
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    vv.set(400, 2); // 2배 확대: 보이는 높이는 절반이지만 되돌리면 800
    expect(onScreenKeyboardOpen()).toBe(false);
  });

  it("주소창이 접히고 펴지는 정도의 변화는 무시한다", () => {
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    vv.set(720);
    expect(onScreenKeyboardOpen()).toBe(false);
  });

  it("훅은 초점·영역 변화를 구독해 다시 그린다", () => {
    render(
      <>
        <input aria-label="역" />
        <Probe />
      </>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("닫힘");
    act(() => {
      screen.getByRole("textbox", { name: "역" }).focus();
      vv.set(400);
    });
    expect(screen.getByTestId("probe")).toHaveTextContent("열림");
    act(() => {
      screen.getByRole("textbox", { name: "역" }).blur();
    });
    expect(screen.getByTestId("probe")).toHaveTextContent("닫힘");
  });
});
