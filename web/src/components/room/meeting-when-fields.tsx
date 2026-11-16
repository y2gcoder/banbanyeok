"use client";

import { ClockIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ChipText, ChoiceChips, chipClass } from "@/components/when/when-picker";
import { dayAfter, formatMeetingDay, MAX_MEETING_DAYS, todayInSeoul, upcomingSaturday } from "@/lib/room/dates";
import { cn } from "@/lib/utils";
import {
  BANDS,
  type Band,
  bandOfTime,
  holidayName,
  meetingHolidayName,
  slotForMeeting,
  slotLabel,
} from "@/lib/when/time-slot";

/** 날짜 칩: 오늘 · 내일 · 이번 토요일 · 날짜 고르기(달력). 같은 날짜라도 누른 칩이 골라져 보이게 어느 칩인지 함께 둔다. */
export type DayChoice = "today" | "tomorrow" | "saturday" | "pick";

/**
 * "언제 만나요?" 입력값. 시각은 선택이고(빈 문자열 = 없음), 시간대만 고를 수 있다. 시각이 있으면 시간대는 그 시각의 시간대다.
 * 화면에 없는 시각을 만들지 않는다: 시간대만 고르면 `band`만 있고 `time`은 비어 있다.
 */
export type MeetingWhen = {
  day: { choice: DayChoice; date: string } | null;
  band: Band | null;
  time: string;
};

export const NO_MEETING_WHEN: MeetingWhen = { day: null, band: null, time: "" };

const PRESETS: readonly { id: Exclude<DayChoice, "pick">; label: string }[] = [
  { id: "today", label: "오늘" },
  { id: "tomorrow", label: "내일" },
  { id: "saturday", label: "이번 토요일" },
];

function presetDate(choice: Exclude<DayChoice, "pick">, today: string): string {
  if (choice === "today") return today;
  if (choice === "tomorrow") return dayAfter(today, 1);
  return upcomingSaturday(today);
}

/** 칩 아래 작은 줄: "11월 21일 (토)", 공휴일이면 " · 공휴일". */
function dayHint(date: string): string {
  return `${formatMeetingDay(date)}${holidayName(date) ? " · 공휴일" : ""}`;
}

/**
 * 방 만들기의 "언제 만나요? (선택)". 폰에서는 날짜 칩 → 시간대 칩 → 정확한 시각(접힘) 순서로 위아래로 쌓고, 칸이 넓으면(@sm,
 * 24rem 이상) 날짜 묶음과 시간대 묶음을 좌우에 둔다. 칩은 높이 44px 이상의 라디오이고, 고른 칩을 다시 누르면 지워진다(= 정하지 않음).
 * "날짜 고르기…"는 칩 모양 아래 투명한 진짜 date 입력 하나라 iOS에서 누르면 날짜 휠이 뜬다. 날짜는 서울 기준이다.
 */
export function MeetingWhenFields({
  id,
  today,
  value,
  onChange,
}: {
  id: string;
  /** 서울 기준 오늘(`YYYY-MM-DD`). 수화 전에는 빈 문자열이라 칩의 날짜 줄을 그리지 않는다. */
  today: string;
  value: MeetingWhen;
  onChange: (next: MeetingWhen) => void;
}) {
  const [timeOpen, setTimeOpen] = useState(value.time !== "");
  const timeRef = useRef<HTMLInputElement>(null);
  const focusTime = useRef(false);
  useEffect(() => {
    if (timeOpen && focusTime.current) timeRef.current?.focus();
    focusTime.current = false;
  }, [timeOpen]);

  const date = value.day?.date ?? null;
  const time = value.time === "" ? null : value.time;
  const band = time ? bandOfTime(time) : value.band;
  const slot = slotForMeeting(date, time, band);
  const holiday = meetingHolidayName(date, time);
  const picked = value.day?.choice === "pick" ? value.day.date : null;

  const selectPreset = (choice: Exclude<DayChoice, "pick">) =>
    onChange({ ...value, day: { choice, date: presetDate(choice, today || todayInSeoul()) } });
  const selectBand = (next: Band) =>
    // 시각과 다른 시간대를 고르면 시각을 지운다(둘이 어긋난 채로 보내지 않는다).
    onChange({ ...value, band: next, time: time && bandOfTime(time) !== next ? "" : value.time });

  return (
    <fieldset className="@container flex flex-col gap-3" aria-describedby={`${id}-basis`}>
      <legend className="mb-1 text-[15px] font-bold text-ink">언제 만나요? (선택)</legend>
      <div className="flex flex-col gap-3 @sm:flex-row @sm:gap-4">
        <fieldset className="flex min-w-0 flex-col gap-1.5 @sm:flex-1">
          <legend className="mb-1.5 text-[13px] font-semibold text-ink-soft">날짜</legend>
          <div className="grid grid-cols-2 gap-1.5">
            {PRESETS.map((preset) => {
              const checked = value.day?.choice === preset.id;
              return (
                <label key={preset.id} className={chipClass(checked)}>
                  <input
                    type="radio"
                    name={`${id}-day`}
                    value={preset.id}
                    checked={checked}
                    onChange={() => selectPreset(preset.id)}
                    onClick={checked ? () => onChange({ ...value, day: null }) : undefined}
                    onKeyDown={
                      checked
                        ? (e) => {
                            if (e.key !== " ") return;
                            e.preventDefault();
                            onChange({ ...value, day: null });
                          }
                        : undefined
                    }
                    className="absolute inset-0 m-0 size-full cursor-pointer appearance-none rounded-xl"
                  />
                  <ChipText
                    label={preset.label}
                    hint={today ? dayHint(presetDate(preset.id, today)) : undefined}
                    checked={checked}
                  />
                </label>
              );
            })}
            <label
              className={cn(
                chipClass(picked !== null),
                "has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-ink",
              )}
            >
              <input
                type="date"
                aria-label="날짜 고르기"
                value={picked ?? ""}
                min={today || undefined}
                max={today ? dayAfter(today, MAX_MEETING_DAYS) : undefined}
                onChange={(e) =>
                  onChange({ ...value, day: e.target.value ? { choice: "pick", date: e.target.value } : null })
                }
                onClick={(e) => openPicker(e.currentTarget)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openPicker(e.currentTarget);
                  }
                }}
                // 칩 전체를 덮는 투명한 진짜 date 입력. 16px 글자라 iOS가 확대하지 않는다. 포커스 테두리는 칩(label)에 그린다.
                className="absolute inset-0 m-0 size-full min-w-0 cursor-pointer appearance-none rounded-xl text-[16px] opacity-0"
              />
              <ChipText
                label={picked ? formatMeetingDay(picked) : "날짜 고르기…"}
                hint={picked && holidayName(picked) ? "공휴일" : undefined}
                checked={picked !== null}
              />
            </label>
          </div>
        </fieldset>
        <div className="flex min-w-0 flex-col gap-1.5 @sm:flex-1">
          <p aria-hidden="true" className="text-[13px] font-semibold text-ink-soft">
            시간대
          </p>
          <ChoiceChips
            name={`${id}-band`}
            label="시간대"
            options={BANDS.map((b) => ({ id: b.id, label: b.label, hint: b.hint }))}
            selected={band}
            onSelect={selectBand}
            onClear={() => onChange({ ...value, band: null, time: "" })}
            className="grid grid-cols-4 gap-1.5 @sm:grid-cols-2"
          />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          aria-expanded={timeOpen}
          aria-controls={`${id}-time-row`}
          onClick={() => {
            if (timeOpen) onChange({ ...value, time: "" });
            focusTime.current = !timeOpen;
            setTimeOpen(!timeOpen);
          }}
          className="inline-flex min-h-11 items-center gap-1.5 self-start rounded-md text-[14px] font-semibold text-ink-soft hover:text-ink"
        >
          <ClockIcon className="size-4" aria-hidden="true" />
          {timeOpen ? "정확한 시각 빼기" : "+ 정확한 시각 넣기"}
        </button>
        <div id={`${id}-time-row`} hidden={!timeOpen} className="flex flex-col gap-1">
          <label htmlFor={`${id}-time`} className="text-[13px] font-semibold text-ink-soft">
            시각
          </label>
          <input
            ref={timeRef}
            id={`${id}-time`}
            type="time"
            value={value.time}
            onChange={(e) => {
              const next = e.target.value.slice(0, 5);
              onChange({ ...value, time: next, band: next ? bandOfTime(next) : value.band });
            }}
            className="h-11 w-full max-w-48 min-w-0 rounded-lg border border-input bg-surface px-3 text-[16px]"
          />
        </div>
      </div>
      <p id={`${id}-basis`} role="status" className="text-[14px] font-semibold text-ink">
        {slotLabel(slot)}
        {holiday ? `(${holiday})` : ""} 기준으로 계산해요
      </p>
      <p className="text-[13px] leading-snug text-muted-foreground">
        요일·시간대마다 열차 간격이 달라 기다리는 시간이 바뀌어요. 안 정하면 평일 낮 기준이에요. 고른 칩을 다시 누르면
        지워져요. 약속일을 정하면 약속 다음 날 방이 사라지고, 안 정하면 마지막 변경 후 7일(최대 30일) 뒤에 사라져요.
      </p>
    </fieldset>
  );
}

/** 데스크톱 브라우저는 date 입력의 글자 칸을 눌러도 달력을 열지 않아서 직접 연다. iOS는 누르면 이미 휠이 뜬다. */
function openPicker(input: HTMLInputElement) {
  try {
    input.showPicker();
  } catch {
    // 지원하지 않거나(옛 브라우저) 사용자 동작 밖이면 그대로 둔다. 입력은 여전히 키보드로 고칠 수 있다.
  }
}
