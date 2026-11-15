"use client";

import { cn } from "@/lib/utils";
import { BANDS, type Band, DAY_TYPES, type DayType, slotOf, splitSlot, type TimeSlot } from "@/lib/when/time-slot";

/**
 * "언제 만나요?" — 요일 유형과 시간대를 고르는 칩(라디오). 폰에서 한 손으로 누르기 쉽게 칸을 크게(높이 44px 이상) 두고,
 * 기본값(지금 시각의 구분)이 처음부터 골라져 보이게 한다. 값은 구분 id(`weekday-day`)다.
 */
export function WhenPicker({
  id,
  value,
  onChange,
  note,
}: {
  id: string;
  value: TimeSlot;
  onChange: (slot: TimeSlot) => void;
  /** 칩 아래 한 줄 안내(예: "지금 시각으로 골라 뒀어요"). */
  note?: string | null;
}) {
  const { day, band } = splitSlot(value);
  return (
    <fieldset className="flex flex-col gap-2.5" aria-describedby={note ? `${id}-note` : undefined}>
      <legend className="mb-1 text-[15px] font-bold text-ink">언제 만나요?</legend>
      <Chips
        name={`${id}-day`}
        label="요일"
        options={DAY_TYPES.map((d) => ({ id: d.id, label: d.label }))}
        selected={day}
        onSelect={(next: DayType) => onChange(slotOf(next, band))}
      />
      <Chips
        name={`${id}-band`}
        label="시간대"
        options={BANDS.map((b) => ({ id: b.id, label: b.label, hint: b.hint }))}
        selected={band}
        onSelect={(next: Band) => onChange(slotOf(day, next))}
      />
      {note ? (
        <p id={`${id}-note`} className="text-[13px] leading-snug text-muted-foreground">
          {note}
        </p>
      ) : null}
    </fieldset>
  );
}

function Chips<T extends string>({
  name,
  label,
  options,
  selected,
  onSelect,
}: {
  name: string;
  label: string;
  options: readonly { id: T; label: string; hint?: string }[];
  selected: T;
  onSelect: (id: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-1.5">
      {options.map((option) => {
        const checked = option.id === selected;
        return (
          <label
            key={option.id}
            className={cn(
              "relative flex min-h-11 cursor-pointer flex-col items-center justify-center rounded-xl border px-1 py-1.5 text-center",
              checked ? "border-ink bg-ink text-primary-foreground" : "border-rule-strong bg-surface text-ink",
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.id}
              checked={checked}
              onChange={() => onSelect(option.id)}
              // 칸 전체를 덮는 투명한 진짜 라디오: 키보드 포커스 테두리(전역 :focus-visible)가 칩 둘레에 그려진다.
              className="absolute inset-0 m-0 size-full cursor-pointer appearance-none rounded-xl"
            />
            <span className="text-[15px] leading-tight font-semibold break-keep">{option.label}</span>
            {option.hint ? (
              <span className={cn("text-[11px] leading-tight", checked ? "opacity-80" : "text-muted-foreground")}>
                {option.hint}
              </span>
            ) : null}
          </label>
        );
      })}
    </div>
  );
}
