// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prefillHref, restoreHref } from "@/lib/form/prefill";
import { encodeShareQuery, type ShareState } from "@/lib/link/codec";
import { searchStations } from "@/lib/stations";
import { HomeForm } from "./home-form";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const code = (name: string) => searchStations(name).find((s) => s.name === name && s.supported)?.code ?? "";

describe("입력 화면 미리 채우기(SEO 페이지의 '다른 역으로 다시 찾기')", () => {
  beforeEach(() => {
    push.mockReset();
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

  it("'다시 입력'으로 돌아오면 모든 줄의 이름·역, 구분, 모드가 그대로다(기억해 둔 '나'와 무관)", async () => {
    window.localStorage.setItem("banbanyeok:me", JSON.stringify({ code: code("잠실"), nickname: "나" }));
    const state: ShareState = {
      origins: [code("혜화"), code("강남"), code("홍대입구")],
      mode: "favor",
      favorIndex: 2,
      nicknames: ["민수", null, "지은"],
      timeSlot: "saturday-night",
    };
    window.history.replaceState(null, "", restoreHref(state));
    render(<HomeForm />);
    expect(screen.getByRole("textbox", { name: "1번째 사람 이름(선택)" })).toHaveValue("민수");
    expect(screen.getByRole("combobox", { name: "민수의 출발역" })).toHaveValue("혜화");
    expect(screen.getByRole("combobox", { name: "친구1의 출발역" })).toHaveValue("강남");
    expect(screen.getByRole("combobox", { name: "지은의 출발역" })).toHaveValue("홍대입구");
    expect(screen.getByRole("radio", { name: "토요일" })).toBeChecked();
    expect(screen.getByRole("radio", { name: /^밤/ })).toBeChecked();
    expect(screen.queryByText(/지금 시각으로 골라 뒀어요/)).toBeNull();

    await userEvent.setup().click(screen.getByRole("button", { name: "만날 역 찾기" }));
    // 아무것도 안 바꾸고 다시 제출하면 똑같은 결과 링크로 간다(모드·배려하던 사람 포함).
    expect(push).toHaveBeenCalledWith(`/result?${encodeShareQuery(state)}`);
  });
});
