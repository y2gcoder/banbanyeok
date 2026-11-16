import { describe, expect, it } from "vitest";
import {
  dayAfter,
  daysSince,
  formatMeetingDate,
  formatMeetingDay,
  isMeetingDateInRange,
  isMeetingDayReached,
  meetingWhenText,
  todayInSeoul,
  upcomingSaturday,
  weekdayOf,
} from "./dates";

describe("요일과 이번 토요일", () => {
  it("요일을 붙인다(서울 날짜 문자열 그대로, 기기 시간대와 무관)", () => {
    expect(weekdayOf("2026-11-21")).toBe("토");
    expect(weekdayOf("2026-11-22")).toBe("일");
    expect(formatMeetingDay("2026-11-21")).toBe("11월 21일 (토)");
    expect(formatMeetingDay("2027-01-01")).toBe("1월 1일 (금)");
  });

  it.each([
    ["월요일이면 그 주 토요일", "2026-11-16", "2026-11-21"],
    ["금요일이면 내일", "2026-11-20", "2026-11-21"],
    ["토요일이면 오늘", "2026-11-21", "2026-11-21"],
    ["일요일이면 다음 토요일(6일 뒤)", "2026-11-22", "2026-11-28"],
    ["해·달을 넘긴다", "2026-12-28", "2027-01-02"],
  ])("%s", (_, today, saturday) => {
    expect(upcomingSaturday(today)).toBe(saturday);
  });

  it("방 요약의 약속은 시각이 있을 때만 시각을, 없으면 시간대 이름을 쓴다", () => {
    expect(meetingWhenText("2026-11-21", "19:00", null)).toBe("11월 21일 (토) 19:00");
    expect(meetingWhenText("2026-11-21", "19:00", "evening")).toBe("11월 21일 (토) 19:00");
    expect(meetingWhenText("2026-11-21", null, "evening")).toBe("11월 21일 (토) 저녁");
    expect(meetingWhenText(null, null, "night")).toBe("밤");
    expect(meetingWhenText("2026-11-21", null, null)).toBe("11월 21일 (토)");
    expect(meetingWhenText(null, null, null)).toBeNull();
  });
});

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
