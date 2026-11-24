/**
 * "언제 만나요?" 구분(요일 유형 × 시간대). 정의 원본은 contracts/time-slots.json, 공휴일은 contracts/holidays.json이고
 * 웹은 생성본(time-slots.gen.ts, pnpm gen:time-slots)을 쓴다. 서버도 같은 규칙으로 방의 약속 날짜·시각을 구분으로 바꾸며
 * contracts/time-slots.json의 vectors로 둘이 같은지 검사한다.
 *
 * 결과 화면의 "○○ 기준" 문구는 서버가 준 `timeBasis.label`을 쓴다. 여기 라벨은 입력 칩과 아직 결과가 없을 때만 쓴다.
 */
import type { TimeBasis, TimeSlotId } from "@/lib/api/types";
import { TIME_SLOTS as data } from "./time-slots.gen.ts";

export type TimeSlot = TimeSlotId;
export type DayType = TimeBasis["dayType"];
export type Band = TimeBasis["band"];

export const DEFAULT_SLOT: TimeSlot = "weekday-day";

export const DAY_TYPES = data.dayTypes as readonly { id: DayType; label: string }[];
export const BANDS = data.bands as readonly { id: Band; label: string; hint: string; from: string; to: string }[];
const HOLIDAYS: Readonly<Record<string, string>> = data.holidays;

/**
 * 운행일이 바뀌는 시각 `HH:MM`("03:00"). 이 전은 전날 운행일의 밤이다(심야 열차는 전날 시간표로 달린다).
 * contracts/time-slots.json의 밤 시간대가 끝나는 시각에서 생성된다(build-time-slots.ts).
 */
export const SERVICE_DAY_START: string = data.serviceDayStart;

export function slotOf(day: DayType, band: Band): TimeSlot {
  return `${day}-${band}` as TimeSlot;
}

export function splitSlot(slot: TimeSlot): { day: DayType; band: Band } {
  const [day, band] = slot.split("-") as [DayType, Band];
  return { day, band };
}

export function isTimeSlot(text: string): text is TimeSlot {
  const [day, band, ...rest] = text.split("-");
  return rest.length === 0 && DAY_TYPES.some((d) => d.id === day) && BANDS.some((b) => b.id === band);
}

function dayLabel(day: DayType): string {
  return DAY_TYPES.find((d) => d.id === day)?.label ?? day;
}

function bandLabel(band: Band): string {
  return BANDS.find((b) => b.id === band)?.label ?? band;
}

/** "토요일 저녁". 서버 `timeBasis.label`과 같은 규칙이다. */
export function slotLabel(slot: TimeSlot): string {
  const { day, band } = splitSlot(slot);
  return `${dayLabel(day)} ${bandLabel(band)}`;
}

/** `HH:MM` → 시간대. 경계는 [from, to)이고 밤은 21:00~다음 날 03:00이다. */
export function bandOfTime(time: string): Band {
  if (time < SERVICE_DAY_START) return "night";
  return BANDS.find((b) => b.from <= time && (b.to > b.from ? time < b.to : true))?.id ?? "night";
}

function previousDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** 그 날짜의 공휴일 이름(관공서 공휴일). 일요일 자체는 이름이 없다. */
export function holidayName(date: string): string | null {
  return HOLIDAYS[date] ?? null;
}

/** 요일 유형. 공휴일·일요일 → holiday, 토요일 → saturday, 그 밖 → weekday. */
function dayTypeOf(date: string): DayType {
  const day = weekday(date);
  if (holidayName(date) !== null || day === 0) return "holiday";
  return day === 6 ? "saturday" : "weekday";
}

/** 운행일: 03:00 전의 시각은 전날이다. 시각 없이 시간대만 고르면 날짜 그대로다. */
function serviceDayOf(date: string, time: string | null): string {
  return time !== null && time < SERVICE_DAY_START ? previousDate(date) : date;
}

/**
 * 약속 날짜(`YYYY-MM-DD`)·시각(`HH:MM`)·시간대 → 구분(contracts/time-slots.json rules). 시각이 있으면 시각으로, 없으면 고른
 * 시간대로, 둘 다 없으면 낮이다. 날짜가 없으면 평일이다. 03:00 전의 시각은 전날 운행일로 요일 유형을 정한다.
 */
export function slotForMeeting(date: string | null, time: string | null, band: Band | null = null): TimeSlot {
  const resolved = time === null ? (band ?? "day") : bandOfTime(time);
  if (date === null) return slotOf("weekday", resolved);
  return slotOf(dayTypeOf(serviceDayOf(date, time)), resolved);
}

/** 그 약속의 운행일이 공휴일이면 이름(서버 `timeBasis.holidayName`과 같은 규칙). */
export function meetingHolidayName(date: string | null, time: string | null): string | null {
  return date === null ? null : holidayName(serviceDayOf(date, time));
}

/** 시간대 이름("저녁"). */
export function bandName(band: Band): string {
  return bandLabel(band);
}

/** 서울 시각의 지금(`YYYY-MM-DD`, `HH:MM`). 기기 시간대와 상관없이 서울 기준이다. */
export function seoulNow(now: Date = new Date()): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

/** 입력 화면의 기본값: 지금(서울) 시각의 구분. */
export function slotNow(now: Date = new Date()): TimeSlot {
  const { date, time } = seoulNow(now);
  return slotForMeeting(date, time);
}
