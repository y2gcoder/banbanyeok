import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { displayAggregate, formatMinutes, formatSeconds, minutesFromSeconds, transferLabel } from "./minutes";

/** 계약 원본을 복사하지 않고 직접 읽는다. shared/app-logic DisplayMinutesVectorsTest도 같은 파일을 통과해야 한다. */
type Vectors = {
  formatVersion: number;
  fromSeconds: { seconds: number; minutes: number }[];
  format: { minutes: number; text: string }[];
  formatSeconds: { seconds: number; text: string }[];
  transferLabel: { transfers: number; text: string }[];
};
const vectors = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../../../../contracts/golden/display-minutes.json"), "utf8"),
) as Vectors;

describe("DisplayMinutes 규칙 — contracts/golden/display-minutes.json", () => {
  it("벡터 형식이 1판이다", () => {
    expect(vectors.formatVersion).toBe(1);
  });

  it.each(vectors.fromSeconds.map((v) => [v.seconds, v.minutes] as const))(
    "%i초 → %i분 (30초는 올림)",
    (seconds, minutes) => {
      expect(minutesFromSeconds(seconds)).toBe(minutes);
    },
  );

  it("음수·소수는 거부한다", () => {
    expect(() => minutesFromSeconds(-1)).toThrow(RangeError);
    expect(() => minutesFromSeconds(1.5)).toThrow(RangeError);
    expect(() => formatMinutes(-1)).toThrow(RangeError);
    expect(() => transferLabel(-1)).toThrow(RangeError);
  });

  it.each(vectors.format.map((v) => [v.minutes, v.text] as const))("%i분 → %s", (minutes, text) => {
    expect(formatMinutes(minutes)).toBe(text);
  });

  it.each(vectors.formatSeconds.map((v) => [v.seconds, v.text] as const))(
    "초를 바로 문구로: %i초 → %s",
    (seconds, text) => {
      expect(formatSeconds(seconds)).toBe(text);
    },
  );

  it.each(vectors.transferLabel.map((v) => [v.transfers, v.text] as const))("환승 표기: %i → %s", (transfers, text) => {
    expect(transferLabel(transfers)).toBe(text);
  });

  it("파생 값은 반올림한 사람별 분에서 다시 계산한다", () => {
    // 초에서 따로 반올림하면 차이 1초 → 0분이지만, 화면의 37분·38분과 맞으려면 1분이어야 한다.
    const agg = displayAggregate([2249, 2250]);
    expect(agg).toEqual({ minutes: [37, 38], max: 38, min: 37, spread: 1, total: 75 });
    expect(agg.total).toBe(agg.minutes.reduce((a, b) => a + b, 0));
  });
});
