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

/** 결과를 처음 본 뒤 지난 일수(음수는 0). 시각을 모르면 0. */
export function daysSince(iso: string | undefined, now: number = Date.now()): number {
  if (!iso) return 0;
  const then = Date.parse(iso);
  return Number.isNaN(then) ? 0 : Math.max(0, Math.floor((now - then) / DAY_MS));
}
