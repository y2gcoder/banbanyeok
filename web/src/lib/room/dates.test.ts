import { describe, expect, it } from "vitest";
import {
  dayAfter,
  daysSince,
  formatMeetingDate,
  isMeetingDateInRange,
  isMeetingDayReached,
  todayInSeoul,
} from "./dates";

describe("약속일", () => {
  it("오늘은 한국 시간 기준이다(UTC 15시 이후는 다음 날)", () => {
    expect(todayInSeoul(new Date("2026-11-15T14:59:00Z"))).toBe("2026-11-15");
    expect(todayInSeoul(new Date("2026-11-15T15:00:00Z"))).toBe("2026-11-16");
  });

  it("dayAfter는 달·해를 넘긴다", () => {
    expect(dayAfter("2026-11-15", 30)).toBe("2026-12-15");
    expect(dayAfter("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("범위: 오늘 이상 30일 이내의 실제 날짜", () => {
    expect(isMeetingDateInRange("2026-11-15", "2026-11-15")).toBe(true);
    expect(isMeetingDateInRange("2026-12-15", "2026-11-15")).toBe(true);
    expect(isMeetingDateInRange("2026-12-16", "2026-11-15")).toBe(false);
    expect(isMeetingDateInRange("2026-11-14", "2026-11-15")).toBe(false);
    expect(isMeetingDateInRange("not-a-date", "2026-11-15")).toBe(false);
    expect(isMeetingDateInRange("2026-02-30", "2026-11-15")).toBe(false);
  });

  it("약속일이 오늘이거나 지났는지(없으면 false)", () => {
    expect(isMeetingDayReached("2026-11-15", "2026-11-15")).toBe(true);
    expect(isMeetingDayReached("2026-11-14", "2026-11-15")).toBe(true);
    expect(isMeetingDayReached("2026-11-16", "2026-11-15")).toBe(false);
    expect(isMeetingDayReached(null, "2026-11-15")).toBe(false);
  });

  it("표시와 경과 일수", () => {
    expect(formatMeetingDate("2026-11-05")).toBe("11월 5일");
    const now = Date.parse("2026-11-15T12:00:00Z");
    expect(daysSince("2026-11-13T12:00:00Z", now)).toBe(2);
    expect(daysSince("2026-11-16T00:00:00Z", now)).toBe(0);
    expect(daysSince(undefined, now)).toBe(0);
    expect(daysSince("garbage", now)).toBe(0);
  });
});
