// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TimeBasisNote } from "./time-basis";

describe("계산 기준 한 줄", () => {
  it("서버가 준 기준 문구를 그대로 쓴다", () => {
    render(
      <TimeBasisNote
        basis={{
          timeSlot: "saturday-evening",
          dayType: "saturday",
          band: "evening",
          label: "토요일 저녁",
          holidayName: null,
        }}
        requested="saturday-evening"
      />,
    );
    expect(screen.getByText("역에서 역까지, 토요일 저녁 기준 시간이에요.")).toBeInTheDocument();
  });

  it("공휴일 이름을 함께 보이고, 요청과 다른 기준으로 계산됐으면 알린다", () => {
    const { rerender } = render(
      <TimeBasisNote
        basis={{
          timeSlot: "holiday-day",
          dayType: "holiday",
          band: "day",
          label: "일요일·공휴일 낮",
          holidayName: "추석",
        }}
        requested="holiday-day"
      />,
    );
    expect(screen.getByText(/일요일·공휴일 낮\(추석\) 기준/)).toBeInTheDocument();
    rerender(
      <TimeBasisNote
        basis={{ timeSlot: "weekday-day", dayType: "weekday", band: "day", label: "평일 낮", holidayName: null }}
        requested="holiday-night"
      />,
    );
    expect(
      screen.getByText(/일요일·공휴일 밤 시간표는 아직 준비 중이라 평일 낮 기준으로 보여 드려요/),
    ).toBeInTheDocument();
  });

  it("결과가 오기 전에는 요청한 구분으로 보인다", () => {
    render(<TimeBasisNote basis={undefined} requested="weekday-morning" />);
    expect(screen.getByText("역에서 역까지, 평일 아침 기준 시간이에요.")).toBeInTheDocument();
  });
});
