// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { parenSafe } from "./paren-safe";

describe("parenSafe", () => {
  it("괄호가 없으면 문자열 그대로다", () => {
    expect(parenSafe("괄호 없는 문장입니다.")).toBe("괄호 없는 문장입니다.");
  });

  it("여는 괄호부터 다음 공백 앞까지를 한 덩어리로 묶고 글자는 그대로 둔다", () => {
    const { container } = render(<p>{parenSafe("모두 외국 회사 (미국·싱가포르)입니다 (7항).")}</p>);
    expect(container.textContent).toBe("모두 외국 회사 (미국·싱가포르)입니다 (7항).");
    const groups = [...container.querySelectorAll("[data-paren-safe]")].map((el) => el.textContent);
    expect(groups).toEqual(["(미국·싱가포르)입니다", "(7항)."]);
  });

  it("공백 없이 이어진 괄호(회사(주소))와 공백이 든 괄호는 첫 말마디만 묶는다", () => {
    const { container } = render(<p>{parenSafe("호스팅 회사(Cloudflare, Inc.) 및 (보호법 제22조)")}</p>);
    expect(container.textContent).toBe("호스팅 회사(Cloudflare, Inc.) 및 (보호법 제22조)");
    const groups = [...container.querySelectorAll("[data-paren-safe]")].map((el) => el.textContent);
    expect(groups).toEqual(["(Cloudflare,", "(보호법"]);
  });

  it("짧은 덩어리는 인라인 nowrap, 긴 덩어리(주소)는 접히는 블록으로 묶는다", () => {
    const url = "(https://support.example.com/very/long/address/path)";
    const { container } = render(<p>{parenSafe(`짧음 (7항) 긴 ${url}`)}</p>);
    const [short, long] = [...container.querySelectorAll("[data-paren-safe]")];
    expect(short?.className).toContain("whitespace-nowrap");
    expect(long?.className).toContain("inline-block");
    expect(long?.className).not.toContain("whitespace-nowrap");
  });
});
