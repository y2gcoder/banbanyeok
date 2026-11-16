// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { keepParens } from "./keep-parens";

const nowrap = (container: HTMLElement) =>
  [...container.querySelectorAll("span.whitespace-nowrap")].map((el) => el.textContent);

describe("keepParens", () => {
  it("괄호가 없으면 글자를 그대로 돌려준다", () => {
    expect(keepParens("괄호 없는 문장")).toBe("괄호 없는 문장");
  });

  it("여는 괄호와 그 바로 뒤 글자 하나를 줄바꿈 없는 한 덩어리로 묶고 글자는 바꾸지 않는다", () => {
    const text = "모두 외국 회사(미국·싱가포르)입니다(7항).";
    const { container } = render(<p>{keepParens(text)}</p>);
    expect(container.textContent).toBe(text);
    expect(nowrap(container)).toEqual(["(미", "(7"]);
  });

  it("긴 괄호도 두 글자만 묶어 좁은 화면에서 가로로 넘치지 않는다", () => {
    const text = "지울 수 있습니다(예: Chrome은 설정 > 개인정보 보호 및 보안).";
    const { container } = render(<p>{keepParens(text)}</p>);
    expect(container.textContent).toBe(text);
    expect(nowrap(container)).toEqual(["(예"]);
  });
});
