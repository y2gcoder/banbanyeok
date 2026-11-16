import { type Band, bandName } from "@/lib/when/time-slot";

/** 약속일 처리. 서버는 한국 시간(Asia/Seoul) 기준으로 약속일을 검사한다. 날짜는 `YYYY-MM-DD` 문자열로만 다룬다. */

const ZONE = "Asia/Seoul";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
/** 서버가 방을 최대 30일만 두므로 약속일도 그 안에서 고르게 한다. */
export const MAX_MEETING_DAYS = 30;

/** 한국 시간 기준 오늘(`YYYY-MM-DD`). */
export function todayInSeoul(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: ZONE }).format(now);
}

function toUtcMs(date: string): number {
  return DATE.test(date) ? Date.parse(`${date}T00:00:00Z`) : Number.NaN;
}

/** `date`의 `days`일 뒤(`YYYY-MM-DD`). */
export function dayAfter(date: string, days: number): string {
  return new Date(toUtcMs(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** 오늘 이상이고 오늘로부터 30일 이내인 실제 날짜인지. */
export function isMeetingDateInRange(date: string, today: string): boolean {
  const ms = toUtcMs(date);
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== date) return false;
  return date >= today && date <= dayAfter(today, MAX_MEETING_DAYS);
}

/** 약속일이 오늘이거나 지났는지(없으면 false). "실제로 어디서 만났나"를 물을 때를 정한다. */
export function isMeetingDayReached(meetingDate: string | null | undefined, today: string): boolean {
  return Boolean(meetingDate) && (meetingDate ?? "") <= today;
}

/** 화면용 약속일: "11월 20일". */
export function formatMeetingDate(date: string): string {
  const [, month, day] = date.split("-");
  return `${Number(month)}월 ${Number(day)}일`;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;
const SATURDAY = 6;

/** 요일 한 글자("토"). */
export function weekdayOf(date: string): string {
  return WEEKDAYS[new Date(toUtcMs(date)).getUTCDay()] ?? "";
}

/** 화면용 약속일과 요일: "11월 21일 (토)". */
export function formatMeetingDay(date: string): string {
  return `${formatMeetingDate(date)} (${weekdayOf(date)})`;
}

/**
 * "이번 토요일": 오늘을 포함해 가장 가까운 토요일. 오늘이 토요일이면 오늘, 일요일이면 6일 뒤(다음 주 토요일)다.
 * 오늘은 서울 기준 날짜(`todayInSeoul`)를 넘긴다.
 */
export function upcomingSaturday(today: string): string {
  const day = new Date(toUtcMs(today)).getUTCDay();
  return dayAfter(today, (SATURDAY - day + 7) % 7);
}

/**
 * 방 요약의 약속: "11월 21일 (토) 19:00", 시각 없이 시간대만 고른 방은 "11월 21일 (토) 저녁", 날짜만 있으면 "11월 21일 (토)".
 * 화면에 없는 시각을 만들어 보이지 않는다. 아무것도 없으면 null.
 */
export function meetingWhenText(date: string | null, time: string | null, band: Band | null): string | null {
  const parts = [date ? formatMeetingDay(date) : null, time ?? (band ? bandName(band) : null)];
  const text = parts.filter(Boolean).join(" ");
  return text === "" ? null : text;
}

/** 결과를 처음 본 뒤 지난 일수(음수는 0). 시각을 모르면 0. */
export function daysSince(iso: string | undefined, now: number = Date.now()): number {
  if (!iso) return 0;
  const then = Date.parse(iso);
  return Number.isNaN(then) ? 0 : Math.max(0, Math.floor((now - then) / DAY_MS));
}
