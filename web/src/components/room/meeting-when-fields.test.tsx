// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { type MeetingWhen, MeetingWhenFields, NO_MEETING_WHEN } from "./meeting-when-fields";

/** 2026-11-16은 월요일이다. */
const TODAY = "2026-11-16";

function Harness({ onValue }: { onValue?: (value: MeetingWhen) => void }) {
  const [value, setValue] = useState<MeetingWhen>(NO_MEETING_WHEN);
  return (
    <MeetingWhenFields
      id="when"
      today={TODAY}
      value={value}
      onChange={(next) => {
        onValue?.(next);
        setValue(next);
      }}
    />
  );
}

const status = () => screen.getByRole("status");
const days = () => screen.getByRole("group", { name: "날짜" });

describe("언제 만나요? (방 만들기)", () => {
  it("날짜 칩은 서울 기준 날짜와 요일을 보이고, 고른 칩을 다시 누르면 지운다", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(status()).toHaveTextContent("평일 낮 기준으로 계산해요");
    expect(screen.getByRole("radio", { name: /오늘\s*11월 16일 \(월\)/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /내일\s*11월 17일 \(화\)/ })).toBeInTheDocument();
    const saturday = screen.getByRole("radio", { name: /이번 토요일\s*11월 21일 \(토\)/ });
    await user.click(saturday);
    expect(saturday).toBeChecked();
    expect(status()).toHaveTextContent("토요일 낮 기준으로 계산해요");
    await user.click(saturday);
    expect(saturday).not.toBeChecked();
    expect(status()).toHaveTextContent("평일 낮 기준으로 계산해요");
  });

  it("시간대만 고르면 시각 없이 시간대만 남긴다(가짜 시각을 만들지 않는다)", async () => {
    const user = userEvent.setup();
    let last: MeetingWhen = NO_MEETING_WHEN;
    render(<Harness onValue={(v) => (last = v)} />);
    await user.click(screen.getByRole("radio", { name: /이번 토요일/ }));
    const evening = screen.getByRole("radio", { name: /저녁\s*17~21시/ });
    await user.click(evening);
    expect(status()).toHaveTextContent("토요일 저녁 기준으로 계산해요");
    expect(last).toEqual({ day: { choice: "saturday", date: "2026-11-21" }, band: "evening", time: "" });
    await user.click(evening);
    expect(evening).not.toBeChecked();
    expect(status()).toHaveTextContent("토요일 낮 기준으로 계산해요");
  });

  it("날짜 고르기는 date 입력 하나이고, 고르면 칩에 요일과 공휴일을 보인다", async () => {
    render(<Harness />);
    const picker = screen.getByLabelText("날짜 고르기");
    expect(picker).toHaveAttribute("type", "date");
    expect(picker).toHaveAttribute("min", TODAY);
    expect(picker).toHaveAttribute("max", "2026-12-16");
    fireEvent.change(picker, { target: { value: "2026-12-25" } });
    expect(days()).toHaveTextContent("12월 25일 (금)");
    expect(days()).toHaveTextContent("공휴일");
    expect(status()).toHaveTextContent("일요일·공휴일 낮(기독탄신일) 기준으로 계산해요");
    for (const radio of screen.getAllByRole("radio", { name: /오늘|내일|이번 토요일/ }))
      expect(radio).not.toBeChecked();
    // iOS 휠의 "지우기"는 빈 값을 보낸다 = 날짜 없음.
    fireEvent.change(picker, { target: { value: "" } });
    expect(days()).toHaveTextContent("날짜 고르기…");
    expect(status()).toHaveTextContent("평일 낮 기준으로 계산해요");
  });

  it("정확한 시각은 접혀 있고, 넣으면 그 시각의 시간대가 골라진다. 다른 시간대를 고르면 시각을 지운다", async () => {
    const user = userEvent.setup();
    let last: MeetingWhen = NO_MEETING_WHEN;
    render(<Harness onValue={(v) => (last = v)} />);
    expect(screen.queryByLabelText("시각")).not.toBeVisible();
    const toggle = screen.getByRole("button", { name: "+ 정확한 시각 넣기" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    const time = screen.getByLabelText("시각");
    expect(time).toBeVisible();
    expect(time).toHaveFocus();
    fireEvent.change(time, { target: { value: "22:00" } });
    expect(screen.getByRole("radio", { name: /밤/ })).toBeChecked();
    expect(status()).toHaveTextContent("평일 밤 기준으로 계산해요");
    await user.click(screen.getByRole("radio", { name: /아침/ }));
    expect(last).toEqual({ day: null, band: "morning", time: "" });
    // 시각을 빼면 입력이 접히고 고른 시간대는 남는다.
    fireEvent.change(time, { target: { value: "19:30" } });
    await user.click(screen.getByRole("button", { name: "정확한 시각 빼기" }));
    expect(last).toEqual({ day: null, band: "evening", time: "" });
    expect(screen.getByLabelText("시각")).not.toBeVisible();
  });

  it("새벽(03:00 전) 시각은 전날 운행일로 계산한다(기존 규칙)", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("radio", { name: /이번 토요일/ }));
    await user.click(screen.getByRole("button", { name: "+ 정확한 시각 넣기" }));
    fireEvent.change(screen.getByLabelText("시각"), { target: { value: "01:30" } });
    expect(status()).toHaveTextContent("평일 밤 기준으로 계산해요");
  });
});
