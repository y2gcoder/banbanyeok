// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
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
