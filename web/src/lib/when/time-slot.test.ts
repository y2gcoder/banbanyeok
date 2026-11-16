import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type Band,
  bandOfTime,
  DEFAULT_SLOT,
  holidayName,
  isTimeSlot,
  meetingHolidayName,
  seoulNow,
  slotForMeeting,
  slotLabel,
  slotNow,
} from "./time-slot";

type Vectors = {
  default: string;
  vectors: { id: string; date: string | null; time: string | null; band?: Band; expected: string }[];
  dayTypes: { id: string; label: string }[];
  bands: { id: string; label: string }[];
};
const contract = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../../../../contracts/time-slots.json"), "utf8"),
) as Vectors;

describe("구분 — contracts/time-slots.json", () => {
  it.each(contract.vectors)("$id", (vector) => {
    expect(slotForMeeting(vector.date, vector.time, vector.band ?? null)).toBe(vector.expected);
  });

  it("기본 구분과 라벨이 계약과 같다", () => {
    expect(DEFAULT_SLOT).toBe(contract.default);
    expect(slotLabel("saturday-evening")).toBe("토요일 저녁");
    expect(slotLabel("holiday-night")).toBe("일요일·공휴일 밤");
    for (const day of contract.dayTypes) {
      for (const band of contract.bands) {
        expect(slotLabel(`${day.id}-${band.id}` as never)).toBe(`${day.label} ${band.label}`);
      }
    }
  });

  it("구분 id를 엄격하게 읽는다", () => {
    expect(isTimeSlot("weekday-day")).toBe(true);
    expect(isTimeSlot("Weekday-Day")).toBe(false);
    expect(isTimeSlot("sunday-dawn")).toBe(false);
    expect(isTimeSlot("weekday-day-x")).toBe(false);
  });

  it("시간대만 고르면 그날 운행일, 03:00 전 시각은 전날 운행일의 공휴일 이름을 쓴다", () => {
    expect(slotForMeeting("2026-12-25", null, "night")).toBe("holiday-night");
    expect(meetingHolidayName("2026-12-25", null)).toBe("기독탄신일");
    expect(meetingHolidayName("2026-12-26", "01:00")).toBe("기독탄신일");
    expect(meetingHolidayName("2026-12-26", "03:00")).toBeNull();
    expect(meetingHolidayName(null, "01:00")).toBeNull();
    // 시각이 있으면 시간대보다 시각이 정한다.
    expect(slotForMeeting("2026-11-18", "08:00", "night")).toBe("weekday-morning");
  });

  it("시간대 경계", () => {
    expect(bandOfTime("02:59")).toBe("night");
    expect(bandOfTime("03:00")).toBe("morning");
    expect(bandOfTime("16:59")).toBe("day");
    expect(bandOfTime("23:59")).toBe("night");
  });

  it("공휴일 이름을 안다(생성본이 contracts/holidays.json과 같다)", () => {
    const holidays = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../../../../contracts/holidays.json"), "utf8"),
    ) as { holidays: { date: string; name: string }[] };
    for (const { date, name } of holidays.holidays) expect(holidayName(date)).toBe(name);
    expect(holidayName("2026-11-18")).toBeNull();
  });

  it("지금은 기기 시간대와 상관없이 서울 시각으로 정한다", () => {
    // 2026-11-21(토) 10:30 UTC = 서울 19:30
    const now = new Date("2026-11-21T10:30:00Z");
    expect(seoulNow(now)).toEqual({ date: "2026-11-21", time: "19:30" });
    expect(slotNow(now)).toBe("saturday-evening");
    // 2026-11-20(금) 16:30 UTC = 서울 토요일 01:30 → 금요일 밤
    expect(slotNow(new Date("2026-11-20T16:30:00Z"))).toBe("weekday-night");
  });
});
