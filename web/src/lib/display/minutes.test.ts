import { describe, expect, it } from "vitest";
import { displayAggregate, formatMinutes, formatSeconds, minutesFromSeconds, transferLabel } from "./minutes";

// 기대값은 shared/app-logic DisplayRulesTest와 같다(p6-notes 4.1). 규칙을 바꾸면 양쪽을 같이 고친다.
describe("DisplayMinutes 규칙", () => {
  it.each([
    [0, 0],
    [29, 0],
    [30, 1],
    [89, 1],
    [90, 2],
    [2249, 37],
    [2250, 38],
    [3599, 60],
    [65534, 1092],
    [2147483647, 35791394],
  ])("%i초 → %i분 (30초는 올림)", (seconds, minutes) => {
    expect(minutesFromSeconds(seconds)).toBe(minutes);
  });

  it("음수·소수는 거부한다", () => {
    expect(() => minutesFromSeconds(-1)).toThrow(RangeError);
    expect(() => minutesFromSeconds(1.5)).toThrow(RangeError);
    expect(() => formatMinutes(-1)).toThrow(RangeError);
    expect(() => transferLabel(-1)).toThrow(RangeError);
  });

  it.each([
    [0, "0분"],
    [59, "59분"],
    [60, "1시간"],
    [64, "1시간 4분"],
    [120, "2시간"],
    [160, "2시간 40분"],
  ])("%i분 → %s", (minutes, text) => {
    expect(formatMinutes(minutes)).toBe(text);
  });

  it("초를 바로 문구로", () => {
    expect(formatSeconds(2250)).toBe("38분");
  });

  it("환승 표기", () => {
    expect(transferLabel(0)).toBe("환승 없음");
    expect(transferLabel(1)).toBe("환승 1번");
  });

  it("파생 값은 반올림한 사람별 분에서 다시 계산한다", () => {
    // 초에서 따로 반올림하면 차이 1초 → 0분이지만, 화면의 37분·38분과 맞으려면 1분이어야 한다.
    const agg = displayAggregate([2249, 2250]);
    expect(agg).toEqual({ minutes: [37, 38], max: 38, min: 37, spread: 1, total: 75 });
    expect(agg.total).toBe(agg.minutes.reduce((a, b) => a + b, 0));
  });
});
