// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prefillHref } from "@/lib/form/prefill";
import { searchStations } from "@/lib/stations";
import { HomeForm } from "./home-form";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const code = (name: string) => searchStations(name).find((s) => s.name === name && s.supported)?.code ?? "";

describe("입력 화면 미리 채우기(SEO 페이지의 '다른 역으로 다시 찾기')", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("ok"))),
    );
    window.localStorage.clear();
  });

  it("/?o=<코드>.<코드>로 열면 두 역이 채워져 버튼이 켜진다", () => {
    window.history.replaceState(null, "", prefillHref([code("강남"), code("홍대입구")]));
    render(<HomeForm />);
    expect(screen.getByRole("combobox", { name: "나의 출발역" })).toHaveValue("강남");
    expect(screen.getByRole("combobox", { name: "친구1의 출발역" })).toHaveValue("홍대입구");
    expect(screen.getByRole("button", { name: "만날 역 찾기" })).toBeEnabled();
  });

  it("기억해 둔 '나'보다 미리 채운 역이 우선한다", () => {
    window.localStorage.setItem("banbanyeok:me", JSON.stringify({ code: code("잠실"), nickname: "민수" }));
    window.history.replaceState(null, "", prefillHref([code("강남"), code("홍대입구")]));
    render(<HomeForm />);
    expect(screen.getByRole("combobox", { name: "나의 출발역" })).toHaveValue("강남");
  });

  it("기억해 둔 '나'만 있을 때도 입력 칸에 역 이름이 보인다", () => {
    window.history.replaceState(null, "", "/");
    window.localStorage.setItem("banbanyeok:me", JSON.stringify({ code: code("잠실"), nickname: "민수" }));
    render(<HomeForm />);
    expect(screen.getByRole("combobox", { name: "민수의 출발역" })).toHaveValue("잠실");
  });

  it("알 수 없는 코드만 있으면 평소처럼 빈 입력", () => {
    window.history.replaceState(null, "", "/?o=zzz.yyy");
    render(<HomeForm />);
    expect(screen.getByRole("button", { name: "만날 역 찾기" })).toBeDisabled();
  });
});
