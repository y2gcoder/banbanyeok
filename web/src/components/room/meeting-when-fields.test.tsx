// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { keepDayAcrossMidnight, type MeetingWhen, MeetingWhenFields, NO_MEETING_WHEN } from "./meeting-when-fields";

/** 2026-11-16은 월요일이다. */
const TODAY = "2026-11-16";

function Harness({ onValue, today = TODAY }: { onValue?: (value: MeetingWhen) => void; today?: string }) {
  const [value, setValue] = useState<MeetingWhen>(NO_MEETING_WHEN);
  return (
    <MeetingWhenFields
      id="when"
      today={today}
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
    // 칩을 누르는 순간의 서울 날짜로 "이번 토요일"을 정하므로 시계를 화면의 오늘(11월 16일 낮)에 맞춘다.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T03:00:00Z"));
    onTestFinished(() => {
      vi.useRealTimers();
    });
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

  it("날짜 선택은 date 입력 하나이고, 고르면 칩에 요일과 공휴일을 보인다", async () => {
    render(<Harness />);
    const picker = screen.getByLabelText("날짜 선택");
    expect(picker).toHaveAttribute("type", "date");
    expect(picker).toHaveAttribute("min", TODAY);
    expect(picker).toHaveAttribute("max", "2026-12-16");
    fireEvent.change(picker, { target: { value: "2026-12-25" } });
    expect(days()).toHaveTextContent("12월 25일");
    expect(days()).toHaveTextContent("금요일 · 공휴일");
    expect(days()).toHaveTextContent("공휴일");
    expect(status()).toHaveTextContent("일요일·공휴일 낮(기독탄신일) 기준으로 계산해요");
    for (const radio of screen.getAllByRole("radio", { name: /오늘|내일|이번 토요일/ }))
      expect(radio).not.toBeChecked();
    // iOS 휠의 "지우기"는 빈 값을 보낸다 = 날짜 없음.
    fireEvent.change(picker, { target: { value: "" } });
    expect(days()).toHaveTextContent("날짜 선택…");
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

  it("03시 전 시각을 넣으면 고른 날짜의 요일로 전날 밤 안내를 한 줄 보인다", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("radio", { name: /이번 토요일/ }));
    await user.click(screen.getByRole("button", { name: "+ 정확한 시각 넣기" }));
    const time = screen.getByLabelText("시각");
    fireEvent.change(time, { target: { value: "01:00" } });
    const note =
      "03시 전은 전날 밤 열차로 계산해요. 지금은 금요일 밤 기준이에요. 토요일 밤 1시라면 날짜를 일요일로 골라 주세요.";
    expect(screen.getByText(note)).toBeVisible();
    expect(time).toHaveAccessibleDescription(note);
    fireEvent.change(time, { target: { value: "03:00" } });
    expect(screen.queryByText(/03시 전은/)).toBeNull();
    expect(time).not.toHaveAttribute("aria-describedby");
  });

  it("달력으로 고른 날짜는 '날짜 지우기' 버튼으로 지운다", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryByRole("button", { name: /날짜 지우기/ })).toBeNull();
    fireEvent.change(screen.getByLabelText("날짜 선택"), { target: { value: "2026-11-25" } });
    await user.click(screen.getByRole("button", { name: "날짜 지우기: 11월 25일 (수)" }));
    expect(days()).toHaveTextContent("날짜 선택…");
    expect(status()).toHaveTextContent("평일 낮 기준으로 계산해요");
    expect(screen.queryByRole("button", { name: /날짜 지우기/ })).toBeNull();
  });

  describe("자정을 넘긴 뒤(가짜 시계)", () => {
    afterEach(() => vi.useRealTimers());

    it("칩을 누르는 순간의 서울 날짜로 정한다(화면을 연 날이 아니라)", async () => {
      // 화면은 11월 16일에 열렸고(today 그대로), 지금은 서울 11월 17일 00:01이다.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-16T15:01:00Z"));
      const user = userEvent.setup();
      let last: MeetingWhen = NO_MEETING_WHEN;
      render(<Harness today="2026-11-16" onValue={(v) => (last = v)} />);
      await user.click(screen.getByRole("radio", { name: /오늘/ }));
      expect(last.day).toEqual({ choice: "today", date: "2026-11-17" });
      await user.click(screen.getByRole("radio", { name: /내일/ }));
      expect(last.day).toEqual({ choice: "tomorrow", date: "2026-11-18" });
    });

    it("날이 바뀌어 칩의 뜻이 달라지면 고른 날짜를 그대로 두고 '고른 날짜'로 옮긴다", () => {
      const tonight = { ...NO_MEETING_WHEN, day: { choice: "today" as const, date: "2026-11-16" } };
      expect(keepDayAcrossMidnight(tonight, "2026-11-16")).toBe(tonight);
      expect(keepDayAcrossMidnight(tonight, "2026-11-17").day).toEqual({ choice: "pick", date: "2026-11-16" });
      const saturday = { ...NO_MEETING_WHEN, day: { choice: "saturday" as const, date: "2026-11-21" } };
      expect(keepDayAcrossMidnight(saturday, "2026-11-17")).toBe(saturday);
    });
  });
});
