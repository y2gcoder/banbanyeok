// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RecommendResult } from "@/lib/api/types";
import { TimeBasisNote } from "./time-basis";

type Basis = RecommendResult["timeBasis"];
const basis = (patch: Partial<Basis> & Pick<Basis, "timeSlot" | "label">): Basis => ({
  requestedTimeSlot: patch.timeSlot,
  dayType: "weekday",
  band: "day",
  holidayName: null,
  ...patch,
});

describe("계산 기준 한 줄", () => {
  it("서버가 준 기준 문구를 그대로 쓴다", () => {
    render(
      <TimeBasisNote
        basis={basis({ timeSlot: "saturday-evening", label: "토요일 저녁" })}
        requested="saturday-evening"
      />,
    );
    expect(screen.getByText("역에서 역까지, 토요일 저녁 기준 시간이에요.")).toBeInTheDocument();
  });

  it("공휴일 이름을 함께 보인다", () => {
    render(
      <TimeBasisNote
        basis={basis({ timeSlot: "holiday-day", label: "일요일·공휴일 낮", holidayName: "추석" })}
        requested={null}
      />,
    );
    expect(screen.getByText(/일요일·공휴일 낮\(추석\) 기준/)).toBeInTheDocument();
  });

  it("서버가 요청과 다른 기준으로 계산했으면(requestedTimeSlot) 알린다 — 방도 서버 값으로 비교한다", () => {
    render(
      <TimeBasisNote
        basis={basis({ timeSlot: "weekday-day", requestedTimeSlot: "holiday-night", label: "평일 낮" })}
        requested={null}
      />,
    );
    expect(
      screen.getByText(/일요일·공휴일 밤 시간은 지금 계산하지 못해 평일 낮 기준으로 보여 드려요/),
    ).toBeInTheDocument();
  });

  it("결과에 기준이 없으면(옛 서버) 평일 낮으로 계산된 것으로 알린다", () => {
    render(<TimeBasisNote basis={null} requested="saturday-night" />);
    expect(screen.getByText(/평일 낮 기준 시간이에요\. 토요일 밤 시간은 지금 계산하지 못해/)).toBeInTheDocument();
  });

  it("결과가 오기 전에는 요청한 구분으로 보인다", () => {
    render(<TimeBasisNote basis={undefined} requested="weekday-morning" />);
    expect(screen.getByText("역에서 역까지, 평일 아침 기준 시간이에요.")).toBeInTheDocument();
  });
});
